package com.wz.reader

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebSettings
import com.bumptech.glide.Glide
import com.bumptech.glide.Priority
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.HttpException
import com.bumptech.glide.load.Options
import com.bumptech.glide.load.data.DataFetcher
import com.bumptech.glide.load.model.GlideUrl
import com.bumptech.glide.load.model.ModelLoader
import com.bumptech.glide.load.model.ModelLoaderFactory
import com.bumptech.glide.load.model.MultiModelLoaderFactory
import com.bumptech.glide.util.ContentLengthInputStream
import com.facebook.react.modules.fresco.FrescoModule
import com.facebook.react.modules.network.ProgressResponseBody
import com.facebook.react.modules.network.CookieJarContainer
import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.network.OkHttpClientProvider
import com.google.net.cronet.okhttptransport.CronetInterceptor
import com.google.net.cronet.okhttptransport.RedirectStrategy
import expo.modules.image.okhttp.GlideUrlWrapper
import expo.modules.image.okhttp.GlideUrlWithDiagnosticHeaders
import expo.modules.video.ReadNetworkVideoClientRegistry
import java.io.EOFException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.IDN
import java.net.CookieHandler
import java.net.InetAddress
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URI
import java.nio.charset.Charset
import java.util.Locale
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import android.util.Log
import android.util.Base64
import okhttp3.ConnectionPool
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Connection
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.ForwardingSource
import okio.ForwardingTimeout
import okio.Timeout
import okio.buffer
import org.chromium.net.CronetEngine
import org.chromium.net.Proxy as CronetProxy
import org.chromium.net.ProxyOptions as CronetProxyOptions

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

internal data class ProxyTarget(val host: String, val port: Int)
internal data class LocalProxyRequest(
  val method: String,
  val requestTarget: String,
  val version: String,
  val target: ProxyTarget,
  val contentLength: Long
)
private const val BLOCKED_PROXY_PORT = 9
private const val MAX_PROXY_CONNECTIONS = 16
private const val PROXY_IDLE_TIMEOUT_MS = 120_000
private const val CRONET_CANCEL_POLL_MS = 100L
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
internal const val FORUM_MEDIA_KIND_HEADER = "X-WZ-Forum-Media-Kind"
internal const val FORUM_MEDIA_GENERATION_HEADER = "X-WZ-Read-Network-Generation"
internal const val FORUM_READ_SOURCE_HEADER = "X-WZ-Forum-Read-Source"
internal const val FORUM_READ_CANCEL_CLASS_HEADER = "X-WZ-Forum-Read-Cancel-Class"
internal const val FORUM_READ_COOKIE_POLICY_HEADER = "X-WZ-Forum-Read-Cookie-Policy"

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
        if (
          request.header(FORUM_MEDIA_IDENTITY_HEADER) == null &&
          request.header(FORUM_MEDIA_KIND_HEADER) == null &&
          request.header(FORUM_MEDIA_GENERATION_HEADER) == null
        ) request else request.newBuilder()
          .removeHeader(FORUM_MEDIA_IDENTITY_HEADER)
          .removeHeader(FORUM_MEDIA_KIND_HEADER)
          .removeHeader(FORUM_MEDIA_GENERATION_HEADER)
          .build()
      )
    val kind = request.header(FORUM_MEDIA_KIND_HEADER)?.takeIf { value -> value == "video" }
    val firstTargetSource = sourceForUri(URI(request.url.toString()))
    val policy = MediaRequestCookiePolicy(source.takeIf { it == firstTargetSource })
    val sanitized = request.newBuilder()
      .removeHeader(FORUM_MEDIA_SOURCE_HEADER)
      .removeHeader(FORUM_MEDIA_IDENTITY_HEADER)
      .removeHeader(FORUM_MEDIA_KIND_HEADER)
      .removeHeader(FORUM_MEDIA_GENERATION_HEADER)
      .removeHeader("Cookie")
      .tag(ForumMediaRequestTag::class.java, ForumMediaRequestTag(source, kind))
      .cacheControl(CacheControl.Builder().noStore().build())
      .build()
    return MediaRequestCookieContext.withPolicy(policy) {
      chain.proceed(sanitized)
    }
  }
}

internal data class ForumMediaRequestTag(
  val source: String,
  val kind: String? = null
)

private class ImageRuntimeGuardInterceptor(private val generation: Long) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    if (chain.request().tag(ImageDiagnosticTag::class.java) != null &&
      generation != NetworkProxyRuntime.currentReadNetworkGeneration()) {
      // A non-recoverable failure must reach the consumer. Call.cancel() would make Fresco
      // treat this as an unmounted image and suppress its failure callback.
      throw java.net.ProtocolException("Image runtime retired")
    }
    return chain.proceed(chain.request())
  }
}

internal data class ForumReadRequestTag(
  val source: String,
  val cancelClass: String
)

internal class ForumReadClearancePolicy(val source: String?, val origin: HttpUrl) {
  var downgraded = false
}

internal class ForumReadRequestInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
    val request = chain.request()
    val source = request.header(FORUM_READ_SOURCE_HEADER)
    val cancelClass = request.header(FORUM_READ_CANCEL_CLASS_HEADER)
    val cookiePolicy = request.header(FORUM_READ_COOKIE_POLICY_HEADER)
    if (source == null && cancelClass == null && cookiePolicy == null) return chain.proceed(request)
    val sanitized = request.newBuilder()
      .removeHeader(FORUM_READ_SOURCE_HEADER)
      .removeHeader(FORUM_READ_CANCEL_CLASS_HEADER)
      .removeHeader(FORUM_READ_COOKIE_POLICY_HEADER)
      .apply {
        if (cookiePolicy != null) {
          removeHeader("Cookie")
          tag(ForumReadClearancePolicy::class.java, ForumReadClearancePolicy(
            source.takeIf { cookiePolicy == "clearance-only" && (it == "linuxdo" || it == "nodeseek") },
            request.url
          ))
          cacheControl(CacheControl.Builder().noStore().build())
        }
        if (
          source != null &&
          (cancelClass == "content" || cancelClass == "health" || cancelClass == "retained")
        ) {
          tag(ForumReadRequestTag::class.java, ForumReadRequestTag(source, cancelClass))
        }
      }
      .build()
    return chain.proceed(sanitized)
  }
}

// Runs after OkHttp's cookie jar on every redirect, including RN credentials: omit.
internal class ForumReadClearanceInterceptor(
  private val sourceForUri: (URI) -> String? = ::managedCookieSource,
  private val cookieReader: (String) -> String? = { CookieManager.getInstance().getCookie(it) },
  private val responses: ManagedCookieResponses = LinuxDoCookieResponses.store
) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val policy = request.tag(ForumReadClearancePolicy::class.java) ?: return chain.proceed(request)
    val url = request.url
    if (policy.source == null || sourceForUri(URI(url.toString())) != policy.source ||
      url.scheme != policy.origin.scheme || url.host != policy.origin.host || url.port != policy.origin.port ||
      (request.method != "GET" && request.method != "HEAD")) policy.downgraded = true
    val sanitized = request.newBuilder().removeHeader("Cookie")
    if (!policy.downgraded) {
      cfClearanceValue(cookieReader(url.toString()))?.let { sanitized.header("Cookie", "cf_clearance=$it") }
    }
    // Clearance-only reads never own authenticated response-cookie writes or fallback.
    responses.observed(url.toString(), null, null)
    return chain.proceed(sanitized.build())
  }
}

internal fun isCloudflareMediaChallenge(request: Request, response: Response): Boolean =
  (request.method == "GET" || request.method == "HEAD") &&
    response.header("Cf-Mitigated")?.equals("challenge", ignoreCase = true) == true

internal fun recoverCloudflareMediaChallenge(
  request: Request,
  original: Response,
  outerCall: Call? = null,
  recover: (Request, Call?) -> Response?
): Response {
  if (!isCloudflareMediaChallenge(request, original)) return original
  val replacement = try {
    recover(request, outerCall)
  } catch (_: Exception) {
    null
  } catch (_: LinkageError) {
    null
  }
  if (replacement == null || replacement === original) return original
  if (isCloudflareMediaChallenge(request, replacement)) {
    replacement.close()
    return original
  }
  original.close()
  return replacement
}

internal class ForumMediaCloudflareFallbackInterceptor(
  private val generation: Long = 0L,
  private val recover: (Request, Call) -> Response? = { request, call ->
    NetworkProxyRuntime.executeCronetMediaFallback(generation, request, call)
  }
) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val original = chain.proceed(chain.request())
    if (!isCloudflareMediaChallenge(chain.request(), original)) return original
    val startedAt = SystemClock.elapsedRealtime()
    val transportGeneration = NetworkProxyRuntime.currentMediaTransportGeneration(generation)
    val source = chain.request().tag(ForumMediaRequestTag::class.java)?.source ?: "anonymous"
    val recovered = recoverCloudflareMediaChallenge(chain.request(), original, chain.call()) { request, call ->
      call?.let { recover(request, it) }
    }
    val outcome = if (recovered === original) "kept-original" else "recovered"
    Log.i(
      LOG_TAG,
      "media cronet source=$source reason=challenge generation=$generation transportGeneration=$transportGeneration outcome=$outcome " +
        "status=${recovered.code} elapsedMs=${SystemClock.elapsedRealtime() - startedAt}"
    )
    return recovered
  }
}

internal class CloseSafeGlideStreamFetcher(
  private val callFactory: Call.Factory,
  private val glideUrl: GlideUrl,
  private val transformBody: (ResponseBody) -> ResponseBody = { body -> body }
) : DataFetcher<InputStream>, okhttp3.Callback {
  private val lock = Any()
  private var callback: DataFetcher.DataCallback<in InputStream>? = null
  private var call: Call? = null
  private var responseBody: ResponseBody? = null
  private var canceled = false
  private var cleaned = false

  override fun loadData(priority: Priority, callback: DataFetcher.DataCallback<in InputStream>) {
    val requestBuilder = Request.Builder().url(glideUrl.toStringUrl())
    glideUrl.headers.forEach { (name, value) -> requestBuilder.addHeader(name, value) }
    val diagnostics = (glideUrl as? GlideUrlWithDiagnosticHeaders)?.diagnosticHeaders.orEmpty()
    if (diagnostics.isNotEmpty()) {
      fun marker(name: String) = diagnostics.entries.firstOrNull { it.key.equals(name, true) }?.value
      requestBuilder.tag(ImageDiagnosticTag::class.java, ImageDiagnosticTag(
        marker("X-WZ-Image-Trace"), marker("X-WZ-Image-Ref"), marker("X-WZ-Image-Session"), "glide"))
    }
    val nextCall = callFactory.newCall(requestBuilder.build())
    val shouldEnqueue = synchronized(lock) {
      if (canceled || cleaned) {
        false
      } else {
        this.callback = callback
        call = nextCall
        true
      }
    }
    if (shouldEnqueue) {
      nextCall.enqueue(this)
    } else {
      nextCall.cancel()
    }
  }

  override fun onFailure(call: Call, e: IOException) {
    synchronized(lock) {
      if (!canceled && !cleaned) callback?.onLoadFailed(e)
    }
  }

  override fun onResponse(call: Call, response: Response) {
    if (!response.isSuccessful) {
      response.close()
      synchronized(lock) {
        if (!canceled && !cleaned) callback?.onLoadFailed(HttpException(response.message, response.code))
      }
      return
    }
    val originalBody = response.body
    if (originalBody == null) {
      response.close()
      synchronized(lock) {
        if (!canceled && !cleaned) callback?.onLoadFailed(IOException("Successful image response has no body"))
      }
      return
    }
    var transformedBody = originalBody
    val nextStream = try {
      transformedBody = transformBody(originalBody)
      ContentLengthInputStream.obtain(transformedBody.byteStream(), transformedBody.contentLength())
    } catch (error: Exception) {
      transformedBody.close()
      synchronized(lock) {
        if (!canceled && !cleaned) callback?.onLoadFailed(error)
      }
      return
    }
    val accepted = synchronized(lock) {
      if (canceled || cleaned) {
        false
      } else {
        responseBody = transformedBody
        callback?.onDataReady(nextStream)
        true
      }
    }
    if (!accepted) transformedBody.close()
  }

  override fun cleanup() {
    val body = synchronized(lock) {
      if (cleaned) return
      cleaned = true
      callback = null
      responseBody.also { responseBody = null }
    }
    body?.close()
  }

  override fun cancel() {
    val owned = synchronized(lock) {
      if (canceled) return
      canceled = true
      callback = null
      val activeCall = call
      val body = responseBody
      responseBody = null
      activeCall to body
    }
    try {
      owned.first?.cancel()
    } finally {
      owned.second?.close()
    }
  }

  override fun getDataClass(): Class<InputStream> = InputStream::class.java

  override fun getDataSource(): DataSource = DataSource.REMOTE
}

internal class CloseSafeGlideUrlLoader(private val callFactory: Call.Factory) : ModelLoader<GlideUrl, InputStream> {
  override fun buildLoadData(
    model: GlideUrl,
    width: Int,
    height: Int,
    options: Options
  ): ModelLoader.LoadData<InputStream> =
    ModelLoader.LoadData(model, CloseSafeGlideStreamFetcher(callFactory, model))

  override fun handles(model: GlideUrl): Boolean = true

  class Factory(private val callFactory: Call.Factory) : ModelLoaderFactory<GlideUrl, InputStream> {
    override fun build(multiFactory: MultiModelLoaderFactory): ModelLoader<GlideUrl, InputStream> =
      CloseSafeGlideUrlLoader(callFactory)

    override fun teardown() = Unit
  }
}

internal class CloseSafeGlideUrlWrapperLoader(
  private val callFactory: Call.Factory,
  private val notifyProgress: (GlideUrlWrapper, Long, Long, Boolean) -> Unit =
    { model, bytesRead, contentLength, done ->
      model.progressListener?.onProgress(bytesRead, contentLength, done)
    }
) : ModelLoader<GlideUrlWrapper, InputStream> {
  override fun buildLoadData(
    model: GlideUrlWrapper,
    width: Int,
    height: Int,
    options: Options
  ): ModelLoader.LoadData<InputStream> = ModelLoader.LoadData(
    model.glideUrl,
    CloseSafeGlideStreamFetcher(callFactory, model.glideUrl) { body ->
      ProgressResponseBody(body) { bytesRead, contentLength, done ->
        notifyProgress(model, bytesRead, contentLength, done)
      }
    }
  )

  override fun handles(model: GlideUrlWrapper): Boolean = true

  class Factory(private val callFactory: Call.Factory) : ModelLoaderFactory<GlideUrlWrapper, InputStream> {
    override fun build(multiFactory: MultiModelLoaderFactory): ModelLoader<GlideUrlWrapper, InputStream> =
      CloseSafeGlideUrlWrapperLoader(callFactory)

    override fun teardown() = Unit
  }
}

private class ReleasingResponseBody(
  private val delegate: ResponseBody,
  private val release: () -> Unit
) : ResponseBody() {
  private val released = AtomicBoolean(false)
  private fun releaseOnce() {
    if (released.compareAndSet(false, true)) release()
  }

  private val trackedSource = object : ForwardingSource(delegate.source()) {
    override fun read(sink: Buffer, byteCount: Long): Long = try {
      super.read(sink, byteCount).also { read -> if (read == -1L) releaseOnce() }
    } catch (error: Throwable) {
      releaseOnce()
      throw error
    }

    override fun close() {
      try {
        super.close()
      } finally {
        releaseOnce()
      }
    }
  }.buffer()

  override fun contentType() = delegate.contentType()
  override fun contentLength() = delegate.contentLength()
  override fun source() = trackedSource
}

internal interface CronetMediaTransportHandle {
  val generation: Long
  fun execute(request: Request, outerCall: Call): Response?
  fun activeCallsCount(): Int
  fun retire(cancelActive: Boolean = true)
}

private class CronetMediaTransport(
  override val generation: Long,
  private val engine: CronetEngine,
  private val interceptor: CronetInterceptor,
  private val client: OkHttpClient,
  private val lifecycleExecutor: ScheduledExecutorService
) : CronetMediaTransportHandle {
  private val lock = Any()
  private val activeCalls = mutableMapOf<Call, Call>()
  private var retired = false
  private var shutdownStarted = false
  private val cancellationWatch = lifecycleExecutor.scheduleWithFixedDelay(
    {
      val canceled = synchronized(lock) {
        activeCalls.filterValues { outerCall -> outerCall.isCanceled() }.keys.toList()
      }
      canceled.forEach { call -> call.cancel() }
    },
    CRONET_CANCEL_POLL_MS,
    CRONET_CANCEL_POLL_MS,
    TimeUnit.MILLISECONDS
  )

  override fun execute(request: Request, outerCall: Call): Response? {
    if (outerCall.isCanceled()) return null
    val call = client.newCall(request)
    val registered = synchronized(lock) {
      if (retired) false else {
        activeCalls[call] = outerCall
        true
      }
    }
    if (!registered) {
      call.cancel()
      return null
    }
    return try {
      val response = call.execute()
      val body = response.body
      if (body == null) {
        finish(call)
        response
      } else {
        response.newBuilder()
          .body(ReleasingResponseBody(body) { finish(call) })
          .build()
      }
    } catch (error: Throwable) {
      call.cancel()
      finish(call)
      throw error
    }
  }

  override fun activeCallsCount(): Int = synchronized(lock) { activeCalls.size }

  override fun retire(cancelActive: Boolean) {
    val calls = synchronized(lock) {
      retired = true
      if (cancelActive) activeCalls.keys.toList() else emptyList()
    }
    calls.forEach { call -> call.cancel() }
    shutdownIfIdle()
  }

  private fun finish(call: Call) {
    synchronized(lock) { activeCalls.remove(call) }
    shutdownIfIdle()
  }

  private fun shutdownIfIdle() {
    val shouldShutdown = synchronized(lock) {
      retired && activeCalls.isEmpty() && !shutdownStarted
    }
    if (!shouldShutdown) return
    synchronized(lock) {
      if (shutdownStarted || !retired || activeCalls.isNotEmpty()) return
      shutdownStarted = true
    }
    cancellationWatch.cancel(false)
    lifecycleExecutor.execute {
      var failureType: String? = null
      try {
        interceptor.close()
      } catch (error: Exception) {
        failureType = error.javaClass.simpleName
      }
      try {
        engine.shutdown()
      } catch (error: Exception) {
        failureType = failureType ?: error.javaClass.simpleName
      }
      if (failureType == null) {
        Log.i(LOG_TAG, "closed media cronet generation=$generation")
      } else {
        Log.w(LOG_TAG, "failed to close media cronet generation=$generation type=" + failureType)
      }
    }
  }
}

internal fun hasOutstandingReadRuntimeWork(
  queued: Int,
  running: Int,
  leases: Int,
  cronetActive: Int
): Boolean = queued > 0 || running > 0 || leases > 0 || cronetActive > 0

private fun cronetProxyOptions(
  proxy: Proxy,
  callbackExecutor: ScheduledExecutorService
): CronetProxyOptions {
  val address = proxy.address() as? InetSocketAddress
    ?: throw IllegalArgumentException("Cronet 仅支持本地 HTTP relay")
  val connectCallback = object : CronetProxy.HttpConnectCallback() {
    override fun onBeforeRequest(request: CronetProxy.HttpConnectCallback.Request) {
      request.proceed(emptyList())
    }

    override fun onResponseReceived(
      responseHeaders: List<android.util.Pair<String, String>>,
      statusCode: Int
    ): Int = if (statusCode in 200..299) {
      CronetProxy.HttpConnectCallback.RESPONSE_ACTION_PROCEED
    } else {
      CronetProxy.HttpConnectCallback.RESPONSE_ACTION_CLOSE
    }
  }
  val cronetProxy = CronetProxy.createHttpProxy(
    CronetProxy.SCHEME_HTTP,
    address.hostString,
    address.port,
    callbackExecutor,
    connectCallback
  )
  return CronetProxyOptions.fromProxyList(
    listOf(cronetProxy),
    CronetProxyOptions.ALL_PROXIES_FAILED_BEHAVIOR_DISALLOW_DIRECT
  )
}

private fun createCronetMediaTransport(
  context: Context,
  generation: Long,
  proxy: Proxy?,
  lifecycleExecutor: ScheduledExecutorService
): CronetMediaTransport {
  val engineBuilder = CronetEngine.Builder(context)
    .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISABLED, 0)
    .enableBrotli(true)
  if (proxy != null) {
    engineBuilder.setProxyOptions(cronetProxyOptions(proxy, lifecycleExecutor))
  }
  val engine = engineBuilder.build()
  val interceptor = CronetInterceptor.newBuilder(engine)
    .setRedirectStrategy(RedirectStrategy.withoutRedirects())
    .build()
  val client = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .addInterceptor(interceptor)
    .build()
  return CronetMediaTransport(generation, engine, interceptor, client, lifecycleExecutor)
}

internal class ReadOnlyWebViewCookieHandler(
  private val responses: ManagedCookieResponses = LinuxDoCookieResponses.store,
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
      responses.observed(uri.toString(), null, null)
      return null
    }
    if (source == null) {
      responses.observed(uri.toString(), null, null)
      return null
    }
    return try {
      cookieReader(uri.toString()).also { responses.observed(uri.toString(), source, it) }
    } catch (error: Exception) {
      responses.observed(uri.toString(), null, null)
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

internal data class ForumReadChannelRecovery(
  val rotated: Boolean,
  val previousGeneration: Long,
  val generation: Long,
  val canceledQueued: Int,
  val canceledRunning: Int
)

internal data class ReadNetworkGenerationLease(
  val retained: Boolean,
  val generation: Long
)

private data class PendingReadRuntimeFinish(
  val traceIdentity: String,
  val source: String,
  val retiredGeneration: Long,
  val publishedGeneration: Long,
  var applied: Boolean,
  var drained: Boolean = false
)

internal fun forumReadChannelHostSuffix(source: String): String = when (source) {
  "nodeseek" -> "nodeseek.com"
  "linuxdo" -> "linux.do"
  "yaohuo" -> "yaohuo.me"
  "v2ex" -> "v2ex.com"
  else -> throw IllegalArgumentException("不支持的论坛读取通道")
}

internal fun requireReadNetworkTraceIdentity(value: String): String {
  val normalized = value.trim()
  require(
    value == normalized &&
      Regex("^(?:trace-[1-9][0-9]{0,9}|[0-9a-f]{1,16})$").matches(normalized)
  ) {
    "读取网络 traceId 不正确"
  }
  return normalized
}

internal fun requireReadNetworkGeneration(value: Double): Long {
  require(value.isFinite() && value >= 0 && value == value.toLong().toDouble()) {
    "读取通道 generation 不正确"
  }
  return value.toLong()
}

internal fun isForumReadChannelRequest(source: String, request: okhttp3.Request): Boolean {
  val readTag = request.tag(ForumReadRequestTag::class.java)
  val readSource = request.header(FORUM_READ_SOURCE_HEADER) ?: readTag?.source
  val readCancelClass = request.header(FORUM_READ_CANCEL_CLASS_HEADER) ?: readTag?.cancelClass
  val mediaSource = request.header(FORUM_MEDIA_SOURCE_HEADER)
    ?: request.tag(ForumMediaRequestTag::class.java)?.source
  val explicitlyOwned =
    (readSource == source && readCancelClass == "content") ||
      (readSource == null && mediaSource == source)
  return (request.method == "GET" || request.method == "HEAD") &&
    explicitlyOwned
}

internal fun isRetainedVideoReadRequest(request: okhttp3.Request): Boolean =
  (request.header(FORUM_MEDIA_KIND_HEADER)
    ?: request.tag(ForumMediaRequestTag::class.java)?.kind) == "video"

internal fun managedLoginCookieClearPlan(source: String): ManagedLoginCookieClearPlan {
  val specification = when (source) {
    "nodeseek" -> Triple(
      listOf("https://www.nodeseek.com/", "https://nodeseek.com/"),
      listOf("nodeseek.com"),
      listOf("session", "connect.sid", "sid")
    )
    "linuxdo" -> Triple(
      listOf("https://linux.do/", "https://www.linux.do/", "https://connect.linux.do/"),
      listOf("linux.do", "connect.linux.do"),
      listOf("_t", "_forum_session", "auth.session-token")
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

internal data class ReadNetworkDiagnosticEvent(
  val timeMs: Long,
  val fields: Map<String, Any>
)

internal object ReadNetworkDiagnostics {
  private const val MAX_EVENTS = 512
  private val lock = Any()
  private val events = ArrayDeque<ReadNetworkDiagnosticEvent>()

  fun record(fields: Map<String, Any>) {
    val event = ReadNetworkDiagnosticEvent(System.currentTimeMillis(), fields)
    DiagnosticJournal.recordNetwork(event.timeMs, fields)
    synchronized(lock) {
      events.addLast(event)
      while (events.size > MAX_EVENTS) events.removeFirst()
    }
    Log.i(
      LOG_TAG,
      "read-network " + fields.entries.joinToString(" ") { entry -> entry.key + "=" + entry.value }
    )
  }

  fun snapshot(): List<ReadNetworkDiagnosticEvent> = synchronized(lock) { events.toList() }
}

private fun opaqueNetworkIdentity(value: Any): String =
  Integer.toHexString(System.identityHashCode(value))

internal enum class ImageRequestPurpose { SVG_PROBE, IMAGE_SAVE }

internal data class RequestDiagnosticTag(val appSessionId: String, val traceId: String, val requestId: String) {
  fun fields(): Map<String, Any> = mapOf("appSessionId" to appSessionId, "traceId" to traceId, "requestId" to requestId)
}

internal fun requestDiagnosticTag(request: Request): RequestDiagnosticTag? {
  request.tag(RequestDiagnosticTag::class.java)?.let { return it }
  val session = request.header("X-WZ-Diagnostic-Session")?.takeIf { it.matches(Regex("session-[a-z0-9]{1,16}-[a-z0-9]{1,16}")) } ?: return null
  val trace = request.header("X-WZ-Diagnostic-Trace")?.takeIf { it.matches(Regex("trace-[1-9][0-9]{0,9}")) } ?: return null
  val requestId = request.header("X-WZ-Diagnostic-Request")?.takeIf { it.matches(Regex("request-[1-9][0-9]{0,9}")) } ?: return null
  return RequestDiagnosticTag(session, trace, requestId)
}

internal class RequestDiagnosticInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    return chain.proceed(request.newBuilder()
      .removeHeader("X-WZ-Diagnostic-Session")
      .removeHeader("X-WZ-Diagnostic-Trace")
      .removeHeader("X-WZ-Diagnostic-Request")
      .tag(RequestDiagnosticTag::class.java, requestDiagnosticTag(request))
      .build())
  }
}

internal data class ImageDiagnosticTag(
  val traceId: String?, val mediaRef: String?, val sessionId: String?, val consumer: String
) {
  fun fields(): Map<String, Any> = buildMap {
    put("imageConsumer", consumer)
    traceId?.let { put("imageTraceId", it) }
    mediaRef?.let { put("mediaRef", it) }
    sessionId?.let { put("imageSessionId", it) }
  }
}

internal fun imageDiagnosticRequest(request: Request, imageLane: Boolean): Request {
  val metadata = request.tag(ImageDiagnosticTag::class.java)
  val tag = ImageDiagnosticTag(
    (metadata?.traceId ?: request.header("X-WZ-Image-Trace"))?.takeIf { it.matches(Regex("trace-[1-9][0-9]{0,9}")) },
    (metadata?.mediaRef ?: request.header("X-WZ-Image-Ref"))?.takeIf { it.matches(Regex("media-[1-9][0-9]{0,9}")) },
    (metadata?.sessionId ?: request.header("X-WZ-Image-Session"))?.takeIf { it.matches(Regex("session-[a-z0-9]{1,16}-[a-z0-9]{1,16}")) },
    when (request.tag(ImageRequestPurpose::class.java)) {
      ImageRequestPurpose.SVG_PROBE -> "svg-probe"
      ImageRequestPurpose.IMAGE_SAVE -> "save-image"
      else -> if (imageLane) "glide" else "fresco"
    }
  )
  return request.newBuilder()
    .removeHeader("X-WZ-Image-Trace").removeHeader("X-WZ-Image-Ref").removeHeader("X-WZ-Image-Session")
    .tag(ImageDiagnosticTag::class.java, tag).build()
}

internal fun imageNetworkFailure(error: Throwable, canceled: Boolean = false): String {
  var cause: Throwable? = error
  repeat(8) {
    if (cause is java.util.concurrent.RejectedExecutionException) return "executor_rejected"
    cause = cause?.cause
  }
  return when {
    error is java.net.SocketTimeoutException || error is java.io.InterruptedIOException && error.message == "timeout" -> "timeout"
    canceled -> "canceled"
    error is javax.net.ssl.SSLException -> "tls_error"
    error is java.net.UnknownHostException -> "dns_error"
    error is IOException -> "network_error"
    else -> "unknown"
  }
}

private fun readNetworkDiagnosticSource(request: Request): String? {
  val tagged = request.header(FORUM_MEDIA_SOURCE_HEADER)
    ?: request.tag(ForumMediaRequestTag::class.java)?.source
  if (tagged == "nodeseek" || tagged == "linuxdo" || tagged == "yaohuo" || tagged == "v2ex") {
    return tagged
  }
  val host = request.url.host.lowercase(Locale.US)
  return when {
    host == "nodeseek.com" || host.endsWith(".nodeseek.com") -> "nodeseek"
    host == "linux.do" || host.endsWith(".linux.do") -> "linuxdo"
    host == "yaohuo.me" || host.endsWith(".yaohuo.me") -> "yaohuo"
    host == "v2ex.com" || host.endsWith(".v2ex.com") -> "v2ex"
    else -> null
  }
}

private fun readNetworkAddressFamily(address: InetAddress?): String = when (address) {
  is Inet4Address -> "ipv4"
  is Inet6Address -> "ipv6"
  else -> "unknown"
}

private fun readNetworkAddressFamilies(addresses: List<InetAddress>): String =
  addresses.map(::readNetworkAddressFamily).distinct().sorted().joinToString(",").ifEmpty { "unknown" }

private open class ForwardingReadNetworkEventListener(
  private val delegate: EventListener
) : EventListener() {
  override fun callStart(call: Call) = delegate.callStart(call)
  override fun proxySelectStart(call: Call, url: HttpUrl) = delegate.proxySelectStart(call, url)
  override fun proxySelectEnd(call: Call, url: HttpUrl, proxies: List<Proxy>) =
    delegate.proxySelectEnd(call, url, proxies)
  override fun dnsStart(call: Call, domainName: String) = delegate.dnsStart(call, domainName)
  override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) =
    delegate.dnsEnd(call, domainName, inetAddressList)
  override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) =
    delegate.connectStart(call, inetSocketAddress, proxy)
  override fun secureConnectStart(call: Call) = delegate.secureConnectStart(call)
  override fun secureConnectEnd(call: Call, handshake: Handshake?) = delegate.secureConnectEnd(call, handshake)
  override fun connectEnd(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?
  ) = delegate.connectEnd(call, inetSocketAddress, proxy, protocol)
  override fun connectFailed(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?,
    ioe: IOException
  ) = delegate.connectFailed(call, inetSocketAddress, proxy, protocol, ioe)
  override fun connectionAcquired(call: Call, connection: Connection) = delegate.connectionAcquired(call, connection)
  override fun connectionReleased(call: Call, connection: Connection) = delegate.connectionReleased(call, connection)
  override fun requestHeadersStart(call: Call) = delegate.requestHeadersStart(call)
  override fun requestHeadersEnd(call: Call, request: Request) = delegate.requestHeadersEnd(call, request)
  override fun requestBodyStart(call: Call) = delegate.requestBodyStart(call)
  override fun requestBodyEnd(call: Call, byteCount: Long) = delegate.requestBodyEnd(call, byteCount)
  override fun requestFailed(call: Call, ioe: IOException) = delegate.requestFailed(call, ioe)
  override fun responseHeadersStart(call: Call) = delegate.responseHeadersStart(call)
  override fun responseHeadersEnd(call: Call, response: Response) = delegate.responseHeadersEnd(call, response)
  override fun responseBodyStart(call: Call) = delegate.responseBodyStart(call)
  override fun responseBodyEnd(call: Call, byteCount: Long) = delegate.responseBodyEnd(call, byteCount)
  override fun responseFailed(call: Call, ioe: IOException) = delegate.responseFailed(call, ioe)
  override fun callEnd(call: Call) = delegate.callEnd(call)
  override fun callFailed(call: Call, ioe: IOException) = delegate.callFailed(call, ioe)
  override fun canceled(call: Call) = delegate.canceled(call)
  override fun satisfactionFailure(call: Call, response: Response) = delegate.satisfactionFailure(call, response)
  override fun cacheHit(call: Call, response: Response) = delegate.cacheHit(call, response)
  override fun cacheMiss(call: Call) = delegate.cacheMiss(call)
  override fun cacheConditionalHit(call: Call, cachedResponse: Response) =
    delegate.cacheConditionalHit(call, cachedResponse)
}

private class ReadNetworkEventListener(
  delegate: EventListener,
  private val generation: Long,
  private val lane: String,
  private val clientIdentity: Any,
  private val connectionPool: ConnectionPool,
  private val dispatcher: Dispatcher,
  private val call: Call,
  private val mediaHealth: MediaConnectionHealth?
) : ForwardingReadNetworkEventListener(delegate) {
  private val startedAt = SystemClock.elapsedRealtime()
  private val source = readNetworkDiagnosticSource(call.request())
  private val requestTag = requestDiagnosticTag(call.request())
  private var acquiredConnection: Connection? = null
  private var headerWriteTimeout: okio.AsyncTimeout? = null

  private fun record(phase: String, extra: Map<String, Any> = emptyMap()) {
    val imageTag = call.request().tag(ImageDiagnosticTag::class.java)
    val safeSource = source
    if (safeSource == null && imageTag == null && requestTag == null) return
    ReadNetworkDiagnostics.record(
      linkedMapOf<String, Any>(
        "operation" to "request",
        "phase" to phase,
        "generation" to generation,
        "source" to (safeSource ?: "anonymous"),
        "lane" to lane,
        "method" to call.request().method,
        "callId" to opaqueNetworkIdentity(call),
        "clientId" to opaqueNetworkIdentity(clientIdentity),
        "poolId" to opaqueNetworkIdentity(connectionPool),
        "dispatcherId" to opaqueNetworkIdentity(dispatcher),
        "elapsedMs" to (SystemClock.elapsedRealtime() - startedAt),
        "queuedCount" to dispatcher.queuedCallsCount(),
        "runningCount" to dispatcher.runningCallsCount()
      ).apply { requestTag?.let { putAll(it.fields()) }; imageTag?.let { putAll(it.fields()) }; putAll(extra) }
    )
  }

  override fun callStart(call: Call) {
    super.callStart(call)
    record("call-start")
  }

  override fun dnsStart(call: Call, domainName: String) {
    super.dnsStart(call, domainName)
    record("dns-start")
  }

  override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
    super.dnsEnd(call, domainName, inetAddressList)
    record("dns-end", mapOf("addressFamily" to readNetworkAddressFamilies(inetAddressList)))
  }

  override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
    super.connectStart(call, inetSocketAddress, proxy)
    record(
      "connect-start",
      mapOf(
        "addressFamily" to readNetworkAddressFamily(inetSocketAddress.address),
        "proxyType" to proxy.type().name.lowercase(Locale.US)
      )
    )
  }

  override fun secureConnectStart(call: Call) {
    super.secureConnectStart(call)
    record("tls-start")
  }

  override fun secureConnectEnd(call: Call, handshake: Handshake?) {
    super.secureConnectEnd(call, handshake)
    record("tls-end", mapOf("tlsVersion" to (handshake?.tlsVersion?.javaName ?: "unknown")))
  }

  override fun connectEnd(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?
  ) {
    super.connectEnd(call, inetSocketAddress, proxy, protocol)
    record(
      "connect-end",
      mapOf(
        "addressFamily" to readNetworkAddressFamily(inetSocketAddress.address),
        "protocol" to (protocol?.toString() ?: "unknown")
      )
    )
  }

  override fun connectFailed(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?,
    ioe: IOException
  ) {
    super.connectFailed(call, inetSocketAddress, proxy, protocol, ioe)
    record(
      "connect-failed",
      mapOf(
        "addressFamily" to readNetworkAddressFamily(inetSocketAddress.address),
        "protocol" to (protocol?.toString() ?: "unknown"),
        "errorType" to ioe.javaClass.simpleName
      )
    )
  }

  override fun connectionAcquired(call: Call, connection: Connection) {
    super.connectionAcquired(call, connection)
    acquiredConnection = connection
    record(
      "connection-acquired",
      mapOf(
        "connectionId" to opaqueNetworkIdentity(connection),
        "addressFamily" to readNetworkAddressFamily(connection.route().socketAddress.address),
        "protocol" to connection.protocol().toString()
      )
    )
  }

  override fun connectionReleased(call: Call, connection: Connection) {
    super.connectionReleased(call, connection)
    headerWriteTimeout?.exit()
    headerWriteTimeout = null
    acquiredConnection = null
    record("connection-released", mapOf("connectionId" to opaqueNetworkIdentity(connection)))
  }

  override fun responseHeadersStart(call: Call) {
    super.responseHeadersStart(call)
    record("response-start")
  }

  override fun requestHeadersStart(call: Call) {
    super.requestHeadersStart(call)
    record("request-headers-start")
    acquiredConnection?.let { connection ->
      headerWriteTimeout = mediaHealth?.startHeaders(connection) {
        record("connection-write-stalled", mapOf("connectionId" to opaqueNetworkIdentity(connection)))
      }
    }
  }

  override fun requestHeadersEnd(call: Call, request: Request) {
    headerWriteTimeout?.exit()
    headerWriteTimeout = null
    super.requestHeadersEnd(call, request)
    record("request-headers-end", if (request.url.scheme == "https" && request.url.host == "linux.do" &&
      request.url.port == 443 && request.header("X-Requested-With") == "XMLHttpRequest")
      mapOf("hasDiscoursePresent" to (request.header("Discourse-Present") == "true")) else emptyMap())
  }

  override fun requestFailed(call: Call, ioe: IOException) {
    headerWriteTimeout?.exit()
    headerWriteTimeout = null
    super.requestFailed(call, ioe)
    record("request-failed", mapOf("errorType" to ioe.javaClass.simpleName))
  }

  override fun responseHeadersEnd(call: Call, response: Response) {
    super.responseHeadersEnd(call, response)
    val mime = response.header("Content-Type")?.substringBefore(';')?.lowercase(Locale.US)
    val contentType = when {
      mime == "image/svg+xml" -> "svg"
      mime?.startsWith("image/") == true -> "image"
      mime == "text/html" -> "html"
      mime == null -> "unknown"
      else -> "other"
    }
    record("response-headers", mapOf("protocol" to response.protocol.toString(), "status" to response.code, "imageContentType" to contentType))
  }

  override fun responseBodyEnd(call: Call, byteCount: Long) {
    super.responseBodyEnd(call, byteCount)
    if (call.request().tag(ImageDiagnosticTag::class.java) != null) record("response-body-end", mapOf("byteCount" to byteCount))
  }

  override fun responseFailed(call: Call, ioe: IOException) {
    super.responseFailed(call, ioe)
    record("response-failed", mapOf("outcome" to "failure", "imageFailure" to "read_error"))
  }

  override fun callEnd(call: Call) {
    super.callEnd(call)
    record("call-end", mapOf("outcome" to "success"))
  }

  override fun callFailed(call: Call, ioe: IOException) {
    super.callFailed(call, ioe)
    record(
      "call-failed",
      mapOf(
        "outcome" to if (call.isCanceled()) "canceled" else "failure",
        "imageFailure" to imageNetworkFailure(ioe, call.isCanceled()),
        "errorType" to ioe.javaClass.simpleName
      )
    )
  }

  override fun canceled(call: Call) {
    super.canceled(call)
    record("call-canceled", mapOf("outcome" to "canceled"))
  }
}

private class ReadNetworkEventListenerFactory(
  private val delegate: EventListener.Factory,
  private val generation: Long,
  private val lane: String,
  private val clientIdentity: Any,
  private val connectionPool: ConnectionPool,
  private val dispatcher: Dispatcher,
  private val mediaHealth: MediaConnectionHealth?
) : EventListener.Factory {
  override fun create(call: Call): EventListener = ReadNetworkEventListener(
    delegate.create(call),
    generation,
    lane,
    clientIdentity,
    connectionPool,
    dispatcher,
    call,
    mediaHealth
  )
}

internal class ReadNetworkGenerationProxySelector(
  private val delegate: ProxySelector
) : ProxySelector() {
  override fun select(uri: URI?): MutableList<Proxy> = delegate.select(uri)

  override fun connectFailed(uri: URI?, sa: java.net.SocketAddress?, ioe: IOException?) {
    delegate.connectFailed(uri, sa, ioe)
  }
}

private class ReadNetworkRuntimeGeneration(
  val generation: Long,
  baseClient: OkHttpClient,
  private val cookieJar: CookieJar,
  proxySelectorDelegate: ProxySelector
) {
  private val baseEventListenerFactory = baseClient.eventListenerFactory
  private val mediaHealth = MediaConnectionHealth(baseClient)
  val dispatcher = Dispatcher()
  val forumConnectionPool = ConnectionPool()
  val mediaConnectionPool = ConnectionPool()
  val proxySelector: ProxySelector = ReadNetworkGenerationProxySelector(proxySelectorDelegate)
  private val cronetLock = Any()
  private var mediaTransportRevision = 0L
  private var cronetMediaTransport: CronetMediaTransportHandle? = null
  private var retirementSealed = false
  @Volatile private var idleSince = 0L
  private val externalLeaseCount = AtomicInteger(0)
  private var lastDrainQueued = -1
  private var lastDrainRunning = -1
  private var lastDrainLeases = -1
  private var lastDrainCronetActive = -1
  @Volatile var retirementTraceIdentity: String? = null
    private set
  @Volatile var retirementSource: String? = null
    private set
  @Volatile var retirementDiagnosticsEnabled = true
    private set
  val mediaClient: OkHttpClient = configureMediaClient(baseClient.newBuilder()).build()
  val imageClient: OkHttpClient = expoImageClient(mediaClient, generation)

  init {
    ReadNetworkVideoClientRegistry.register(generation, mediaClient)
  }

  fun configureManagedClient(builder: OkHttpClient.Builder): OkHttpClient.Builder =
    configureClient(builder, forumConnectionPool, "forum")

  fun configureMediaClient(builder: OkHttpClient.Builder): OkHttpClient.Builder =
    mediaHealth.configure(configureClient(builder, mediaConnectionPool, "media"))

  fun currentMediaTransportGeneration(): Long = synchronized(cronetLock) {
    generation * 1_000_000L + mediaTransportRevision
  }

  fun currentCronetMediaTransport(
    context: Context,
    proxy: Proxy?,
    lifecycleExecutor: ScheduledExecutorService
  ): CronetMediaTransportHandle = synchronized(cronetLock) {
    check(!retirementSealed) { "媒体网络 generation 已退休" }
    cronetMediaTransport?.let { return@synchronized it }
    createCronetMediaTransport(
      context,
      currentMediaTransportGeneration(),
      proxy,
      lifecycleExecutor
    ).also { created ->
      cronetMediaTransport = created
      Log.i(
        LOG_TAG,
        "media-cronet phase=publish generation=" + generation +
          " transportGeneration=" + created.generation
      )
    }
  }

  fun resetCronetMediaTransport(): CronetMediaTransportHandle? = synchronized(cronetLock) {
    mediaTransportRevision += 1
    cronetMediaTransport.also { cronetMediaTransport = null }
  }

  fun retireCronetMediaTransport(): CronetMediaTransportHandle? = synchronized(cronetLock) {
    cronetMediaTransport.also { cronetMediaTransport = null }
  }

  fun installCronetMediaTransportForTests(transport: CronetMediaTransportHandle): Boolean =
    synchronized(cronetLock) {
      if (cronetMediaTransport != null || retirementSealed) false else {
        cronetMediaTransport = transport
        true
      }
    }

  fun activeCronetCalls(): Int = synchronized(cronetLock) {
    cronetMediaTransport?.activeCallsCount() ?: 0
  }

  fun markRetiring(traceIdentity: String, source: String, diagnosticsEnabled: Boolean = true) {
    retirementTraceIdentity = traceIdentity
    retirementSource = source
    retirementDiagnosticsEnabled = diagnosticsEnabled
  }

  fun sealRetirement() = synchronized(cronetLock) {
    retirementSealed = true
  }

  fun retainExternalLease() {
    externalLeaseCount.incrementAndGet()
    idleSince = 0L
  }

  fun releaseExternalLease(): Int {
    while (true) {
      val current = externalLeaseCount.get()
      if (current <= 0) return 0
      if (externalLeaseCount.compareAndSet(current, current - 1)) return current - 1
    }
  }

  fun externalLeases(): Int = externalLeaseCount.get()

  fun shouldRecordDrainState(queued: Int, running: Int, leases: Int, cronetActive: Int): Boolean {
    if (
      queued == lastDrainQueued &&
      running == lastDrainRunning &&
      leases == lastDrainLeases &&
      cronetActive == lastDrainCronetActive
    ) return false
    lastDrainQueued = queued
    lastDrainRunning = running
    lastDrainLeases = leases
    lastDrainCronetActive = cronetActive
    return true
  }

  fun isReadyToDrain(now: Long): Boolean {
    if (
      hasOutstandingReadRuntimeWork(
        dispatcher.queuedCallsCount(),
        dispatcher.runningCallsCount(),
        externalLeaseCount.get(),
        activeCronetCalls()
      )
    ) {
      idleSince = 0L
      return false
    }
    if (idleSince == 0L) {
      idleSince = now
      return false
    }
    return now - idleSince >= 250L
  }

  fun finishRetirement() {
    ReadNetworkVideoClientRegistry.unregister(generation, mediaClient)
    forumConnectionPool.evictAll()
    mediaConnectionPool.evictAll()
    retireCronetMediaTransport()?.retire(cancelActive = false)
    dispatcher.executorService.shutdown()
  }

  private fun configureClient(
    builder: OkHttpClient.Builder,
    connectionPool: ConnectionPool,
    lane: String
  ): OkHttpClient.Builder {
    val clientIdentity = Any()
    builder.cookieJar(cookieJar)
    builder.proxySelector(proxySelector)
    builder.connectionPool(connectionPool)
    builder.dispatcher(dispatcher)
    builder.eventListenerFactory(
      ReadNetworkEventListenerFactory(
        baseEventListenerFactory,
        generation,
        lane,
        clientIdentity,
        connectionPool,
        dispatcher,
        if (lane == "media") mediaHealth else null
      )
    )
    builder.interceptors().removeAll { interceptor -> interceptor is ForumReadRequestInterceptor }
    builder.interceptors().removeAll { interceptor -> interceptor is ForumMediaRequestInterceptor }
    builder.interceptors().removeAll { interceptor -> interceptor is RequestDiagnosticInterceptor }
    builder.addInterceptor(RequestDiagnosticInterceptor())
    builder.addInterceptor(ForumReadRequestInterceptor())
    builder.addInterceptor(ForumMediaRequestInterceptor())
    builder.interceptors().removeAll { it is CookieResponseContextInterceptor }
    builder.networkInterceptors().removeAll { it is CookieResponseInterceptor }
    builder.networkInterceptors().removeAll { it is ForumReadClearanceInterceptor }
    builder.addInterceptor(CookieResponseContextInterceptor(LinuxDoCookieResponses.store))
    builder.addNetworkInterceptor(ForumReadClearanceInterceptor())
    builder.addNetworkInterceptor(CookieResponseInterceptor(LinuxDoCookieResponses.store))
    builder.networkInterceptors().removeAll { it is ImageRuntimeGuardInterceptor }
    if (lane == "media") builder.addNetworkInterceptor(ImageRuntimeGuardInterceptor(generation))
    return builder
  }
}

object NetworkProxyRuntime {
  private val lock = Any()
  private val rotationLock = Any()
  private val selector = NetworkProxySelector()
  private val blockedProxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", BLOCKED_PROXY_PORT))
  @Volatile private var localProxy: Proxy? = blockedProxy
  private val cookieHandler = ReadOnlyWebViewCookieHandler()
  private val cookieJar = ReadOnlyCookieJarContainer(JavaNetCookieJar(cookieHandler))
  private val cronetLifecycleExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "WzMediaCronetLifecycle").apply { isDaemon = true }
  }
  private val runtimeLifecycleExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "WzReadRuntimeLifecycle").apply { isDaemon = true }
  }
  private val retiredGenerations = ConcurrentHashMap<Long, ReadNetworkRuntimeGeneration>()
  private val pendingRotationFinishes = mutableMapOf<String, PendingReadRuntimeFinish>()
  private var baseClientTemplate = OkHttpClient()
  private var nextGenerationNumber = 1L
  @Volatile private var currentGeneration = ReadNetworkRuntimeGeneration(
    0L,
    baseClientTemplate,
    cookieJar,
    selector
  )
  @Volatile private var applicationContext: Context? = null
  private val imageCalls = mutableMapOf<Call, ReadNetworkRuntimeGeneration>()
  internal val frescoCallFactory = Call.Factory { request -> RuntimeImageCall(request, false) }
  internal val imageCallFactory = Call.Factory { request -> RuntimeImageCall(request, true) }
  private val imageCancellationExecutor by lazy {
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "WzImageCancellation").apply { isDaemon = true }
    }
  }

  // Consumers keep this factory for their entire lifetime; only execution takes a generation lease.
  private class RuntimeImageCall(
    private val originalRequest: Request,
    private val imageLane: Boolean
  ) : Call {
    private val executed = AtomicBoolean(false)
    private val canceled = AtomicBoolean(false)
    private val released = AtomicBoolean(false)
    private val failureRecorded = AtomicBoolean(false)
    private var startedGeneration = -1L
    @Volatile private var delegate: Call? = null
    private val callTimeout = ForwardingTimeout(Timeout().timeout(
      (if (imageLane) currentGeneration.imageClient else currentGeneration.mediaClient).callTimeoutMillis.toLong(),
      TimeUnit.MILLISECONDS
    ))

    override fun request(): Request = originalRequest
    override fun isExecuted(): Boolean = executed.get()
    override fun isCanceled(): Boolean = canceled.get() || delegate?.isCanceled() == true
    override fun timeout(): Timeout = callTimeout
    override fun clone(): Call = RuntimeImageCall(originalRequest, imageLane)
    override fun cancel() {
      canceled.set(true)
      delegate?.cancel()
    }

    private fun start(): Call {
      check(executed.compareAndSet(false, true)) { "Already Executed" }
      val call = synchronized(lock) {
        val runtime = currentGeneration
        startedGeneration = runtime.generation
        val client = if (imageLane) runtime.imageClient else runtime.mediaClient
        client.newCall(imageDiagnosticRequest(originalRequest, imageLane)).also { call ->
          val timeout = call.timeout()
          timeout.timeout(callTimeout.timeoutNanos(), TimeUnit.NANOSECONDS)
          if (callTimeout.hasDeadline()) timeout.deadlineNanoTime(callTimeout.deadlineNanoTime())
          callTimeout.setDelegate(timeout)
          runtime.retainExternalLease()
          imageCalls[call] = runtime
          delegate = call
        }
      }
      return call
    }

    private fun release() {
      if (!released.compareAndSet(false, true)) return
      val runtime = synchronized(lock) {
        imageCalls.remove(delegate)?.also { it.releaseExternalLease() }
      } ?: return
      ReadNetworkDiagnostics.record(buildMap {
        put("operation", "request"); put("phase", "image-lease-released")
        put("generation", runtime.generation); put("callId", opaqueNetworkIdentity(delegate!!))
        put("dispatcherId", opaqueNetworkIdentity(runtime.dispatcher))
        delegate?.request()?.tag(ImageDiagnosticTag::class.java)?.let { putAll(it.fields()) }
      })
      if (retiredGenerations[runtime.generation] === runtime) scheduleDrain(runtime)
    }

    private fun failed(error: Throwable) {
      if (!failureRecorded.compareAndSet(false, true)) return
      ReadNetworkDiagnostics.record(buildMap {
        put("operation", "request"); put("phase", "image-call-failed"); put("outcome", "failure")
        put("imageFailure", imageNetworkFailure(error, isCanceled()))
        if (startedGeneration >= 0) put("generation", startedGeneration)
        put("callId", opaqueNetworkIdentity(delegate ?: this@RuntimeImageCall))
        delegate?.request()?.tag(ImageDiagnosticTag::class.java)?.let { putAll(it.fields()) }
      })
      release()
    }

    private fun track(response: Response): Response {
      val body = response.body
      if (body == null) { release(); return response }
      return response.newBuilder().body(ReleasingResponseBody(body, ::release)).build()
    }

    override fun execute(): Response {
      val call = start()
      try {
        if (canceled.get()) call.cancel()
        return track(call.execute())
      } catch (error: Throwable) { failed(error); throw error }
    }

    override fun enqueue(responseCallback: Callback) {
      val call = start()
      try {
        if (canceled.get()) call.cancel()
        call.enqueue(object : Callback {
          override fun onFailure(call: Call, error: IOException) {
            failed(error)
            responseCallback.onFailure(this@RuntimeImageCall, error)
          }
          override fun onResponse(call: Call, response: Response) {
            val tracked = track(response)
            try { responseCallback.onResponse(this@RuntimeImageCall, tracked) }
            catch (error: Throwable) { tracked.close(); throw error }
          }
        })
      } catch (error: Throwable) { failed(error); throw error }
    }
  }
  private var installed = false

  fun install(context: Context) {
    DiagnosticJournal.recordStartupPhase("network-start")
    val previous: ReadNetworkRuntimeGeneration
    val installedGeneration: ReadNetworkRuntimeGeneration
    val appContext = context.applicationContext
    synchronized(lock) {
      if (installed) return
      selector.setDelegate(ProxySelector.getDefault())
      ProxySelector.setDefault(selector)
      baseClientTemplate = OkHttpClientProvider.createClientBuilder(appContext).build()
      DiagnosticJournal.recordStartupPhase("network-client")
      previous = currentGeneration
      installedGeneration = ReadNetworkRuntimeGeneration(
        previous.generation,
        baseClientTemplate,
        cookieJar,
        selector
      )
      currentGeneration = installedGeneration
      nextGenerationNumber = maxOf(nextGenerationNumber, installedGeneration.generation + 1L)
      applicationContext = appContext
      OkHttpClientProvider.setOkHttpClientFactory { currentGeneration.mediaClient }
      NetworkingModule.setCustomClientBuilder { builder ->
        configureManagedClient(builder)
      }
      installed = true
    }
    FrescoModule.setNetworkFetcherFactory(frescoCallFactory, imageCancellationExecutor)
    installExpoImageClientOnMainThread(appContext, imageCallFactory)
    DiagnosticJournal.recordStartupPhase("network-ready")
    previous.finishRetirement()
    Log.i(LOG_TAG, "installed read runtime " + runtimeIdentityFields(installedGeneration))
    ReadNetworkDiagnostics.record(
      linkedMapOf<String, Any>("operation" to "install", "phase" to "publish").apply {
        putAll(runtimeIdentityDiagnosticFields(installedGeneration))
      }
    )
  }

  fun setLocalProxyPort(port: Int?) = synchronized(rotationLock) {
    val next = port?.let { Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", it)) }
    val retired = synchronized(lock) {
      localProxy = next
      allGenerationsLocked().mapNotNull { generation -> generation.resetCronetMediaTransport() }
    }
    retired.forEach { transport -> transport.retire() }
    Log.i(LOG_TAG, if (port == null) "disabled app proxy" else "enabled app proxy")
  }

  fun blockNetworkRequests() = synchronized(rotationLock) {
    val generations: List<ReadNetworkRuntimeGeneration>
    val retired: List<CronetMediaTransportHandle>
    synchronized(lock) {
      localProxy = blockedProxy
      generations = allGenerationsLocked()
      retired = generations.mapNotNull { generation -> generation.resetCronetMediaTransport() }
    }
    retired.forEach { transport -> transport.retire() }
    generations.forEach { generation ->
      synchronized(lock) { imageCalls.filterValues { it === generation }.keys.toList() }
        .forEach { it.cancel() }
      generation.dispatcher.cancelAll()
      generation.forumConnectionPool.evictAll()
      generation.mediaConnectionPool.evictAll()
    }
    Log.i(LOG_TAG, "blocked app requests while proxy switches")
  }

  internal fun configureManagedClient(builder: OkHttpClient.Builder): OkHttpClient.Builder =
    currentGeneration.configureManagedClient(builder)

  internal fun configureMediaClient(builder: OkHttpClient.Builder): OkHttpClient.Builder =
    currentGeneration.configureMediaClient(builder)

  internal fun currentReadNetworkGeneration(): Long = currentGeneration.generation

  internal fun currentMediaTransportGeneration(
    runtimeGeneration: Long = currentGeneration.generation
  ): Long = generation(runtimeGeneration)?.currentMediaTransportGeneration() ?: runtimeGeneration

  internal fun executeCronetMediaFallback(
    runtimeGeneration: Long,
    request: Request,
    outerCall: Call
  ): Response? {
    val context = applicationContext ?: throw IllegalStateException("网络运行时尚未安装")
    val generation = generation(runtimeGeneration)
      ?: throw IllegalStateException("媒体网络 generation 已退休")
    return generation.currentCronetMediaTransport(
      context,
      localProxy,
      cronetLifecycleExecutor
    ).execute(LinuxDoCookieResponses.store.fallbackRequest(request).also {
      LinuxDoCookieResponses.store.sending(it, outerCall, "cronet")
    }, outerCall)?.also {
      LinuxDoCookieResponses.store.receive(it, outerCall)
    }
  }

  internal fun imageClientForTests(): OkHttpClient = currentGeneration.imageClient

  internal fun recoverForumReadChannel(
    source: String,
    expectedGeneration: Long = currentGeneration.generation,
    traceIdentity: String = java.lang.Integer.toHexString(System.identityHashCode(Any()))
  ): ForumReadChannelRecovery = synchronized(rotationLock) {
    requireReadNetworkTraceIdentity(traceIdentity)
    val supportedSource = try {
      forumReadChannelHostSuffix(source)
      true
    } catch (_: IllegalArgumentException) {
      false
    }
    val diagnosticSource = source.takeIf { supportedSource }
    var terminalRecorded = false
    fun recordTerminal(outcome: String, generation: Long, error: Throwable? = null) {
      if (terminalRecorded) return
      terminalRecorded = true
      Log.i(
        LOG_TAG,
        "rotate-read-runtime phase=finish source=" + (diagnosticSource ?: "unsupported") +
          " generation=" + generation + " outcome=" + outcome +
          (error?.let { failure -> " type=" + failure.javaClass.simpleName } ?: "")
      )
      ReadNetworkDiagnostics.record(
        linkedMapOf<String, Any>(
          "operation" to "rotate-read-runtime",
          "phase" to "finish",
          "traceIdentity" to traceIdentity,
          "generation" to generation,
          "outcome" to outcome
        ).apply {
          if (diagnosticSource != null) put("source", diagnosticSource)
          if (error != null) put("errorType", error.javaClass.simpleName)
        }
      )
    }

    ReadNetworkDiagnostics.record(
      linkedMapOf<String, Any>(
        "operation" to "rotate-read-runtime",
        "phase" to "intent",
        "traceIdentity" to traceIdentity,
        "previousGeneration" to expectedGeneration,
        "generation" to currentGeneration.generation
      ).apply { if (diagnosticSource != null) put("source", diagnosticSource) }
    )
    if (!supportedSource) {
      val error = IllegalArgumentException("不支持的论坛读取通道")
      recordTerminal("failure", currentGeneration.generation, error)
      throw error
    }
    try {
      val rotation = synchronized(lock) {
        val previous = currentGeneration
        if (expectedGeneration != previous.generation) {
          null
        } else {
          val next = ReadNetworkRuntimeGeneration(
            nextGenerationNumber++,
            baseClientTemplate,
            cookieJar,
            selector
          )
          previous.markRetiring(traceIdentity, source)
          retiredGenerations[previous.generation] = previous
          pendingRotationFinishes[traceIdentity] = PendingReadRuntimeFinish(
            traceIdentity,
            source,
            previous.generation,
            next.generation,
            applied = !traceIdentity.startsWith("trace-")
          )
          currentGeneration = next
          previous to next
        }
      }
      if (rotation == null) {
        val current = currentGeneration.generation
        if (!traceIdentity.startsWith("trace-")) {
          recordTerminal("noop", current)
        }
        return@synchronized ForumReadChannelRecovery(
          false,
          expectedGeneration,
          current,
          0,
          0
        )
      }
      val (previous, next) = rotation
      Log.i(
        LOG_TAG,
        "rotate-read-runtime phase=publish source=" + source +
          " previousGeneration=" + previous.generation + " " + runtimeIdentityFields(next)
      )
      ReadNetworkDiagnostics.record(
        linkedMapOf<String, Any>(
          "operation" to "rotate-read-runtime",
          "phase" to "publish",
          "traceIdentity" to traceIdentity,
          "source" to source,
          "previousGeneration" to previous.generation
        ).apply { putAll(runtimeIdentityDiagnosticFields(next)) }
      )
      val queued = previous.dispatcher.queuedCalls()
        .filter { call ->
          isForumReadChannelRequest(source, call.request()) && !isRetainedVideoReadRequest(call.request())
        }
      val registered = synchronized(lock) { imageCalls.filterValues { it === previous }.keys.toList() }
      val running = (previous.dispatcher.runningCalls() + registered).distinct().filterNot { it in queued }
        .filter { call ->
          isForumReadChannelRequest(source, call.request()) && !isRetainedVideoReadRequest(call.request())
        }
      queued.forEach { call -> call.cancel() }
      running.forEach { call -> call.cancel() }
      Log.i(
        LOG_TAG,
        "rotate-read-runtime phase=cancel source=" + source +
          " previousGeneration=" + previous.generation +
          " generation=" + next.generation +
          " queued=" + queued.size + " running=" + running.size
      )
      ReadNetworkDiagnostics.record(
        mapOf(
          "operation" to "rotate-read-runtime",
          "phase" to "cancel",
          "traceIdentity" to traceIdentity,
          "source" to source,
          "previousGeneration" to previous.generation,
          "generation" to next.generation,
          "queuedCount" to queued.size,
          "runningCount" to running.size
        )
      )
      scheduleDrain(previous)
      ForumReadChannelRecovery(
        true,
        previous.generation,
        next.generation,
        queued.size,
        running.size
      )
    } catch (error: Throwable) {
      if (!terminalRecorded) {
        synchronized(lock) { pendingRotationFinishes.remove(traceIdentity) }
        recordTerminal("failure", currentGeneration.generation, error)
      }
      throw error
    }
  }

  internal fun retainReadNetworkGeneration(expectedGeneration: Long): ReadNetworkGenerationLease = synchronized(lock) {
    val runtime = currentGeneration
    if (runtime.generation != expectedGeneration) {
      return@synchronized ReadNetworkGenerationLease(false, runtime.generation)
    }
    runtime.retainExternalLease()
    ReadNetworkGenerationLease(true, runtime.generation)
  }

  internal fun releaseReadNetworkGeneration(generation: Long): Boolean {
    val runtime = synchronized(lock) {
      generationLocked(generation)?.also { current -> current.releaseExternalLease() }
    } ?: return false
    if (retiredGenerations[generation] === runtime) scheduleDrain(runtime)
    return true
  }

  internal fun acknowledgeReadNetworkRuntimeApply(
    traceIdentity: String,
    previousGeneration: Long,
    generation: Long
  ): Boolean {
    requireReadNetworkTraceIdentity(traceIdentity)
    val finish = synchronized(lock) {
      val pending = pendingRotationFinishes[traceIdentity] ?: return false
      if (
        pending.retiredGeneration != previousGeneration ||
        pending.publishedGeneration != generation
      ) return false
      pending.applied = true
      if (!pending.drained) null else {
        pendingRotationFinishes.remove(traceIdentity)
        pending
      }
    }
    finish?.let(::recordReadNetworkRuntimeFinish)
    return true
  }

  internal fun hasReadNetworkGenerationForTests(generation: Long): Boolean = generation(generation) != null

  internal fun installCronetMediaTransportForTests(
    generation: Long,
    transport: CronetMediaTransportHandle
  ): Boolean = synchronized(lock) {
    generationLocked(generation)?.installCronetMediaTransportForTests(transport) ?: false
  }

  private fun generation(generation: Long): ReadNetworkRuntimeGeneration? = synchronized(lock) {
    generationLocked(generation)
  }

  private fun generationLocked(generation: Long): ReadNetworkRuntimeGeneration? =
    currentGeneration.takeIf { current -> current.generation == generation }
      ?: retiredGenerations[generation]

  private fun allGenerationsLocked(): List<ReadNetworkRuntimeGeneration> =
    listOf(currentGeneration) + retiredGenerations.values.filter { generation -> generation !== currentGeneration }

  private fun scheduleDrain(generation: ReadNetworkRuntimeGeneration) {
    runtimeLifecycleExecutor.schedule(
      { drainRetiredGeneration(generation) },
      100L,
      TimeUnit.MILLISECONDS
    )
  }

  private fun drainRetiredGeneration(generation: ReadNetworkRuntimeGeneration) {
    val queued = generation.dispatcher.queuedCallsCount()
    val running = generation.dispatcher.runningCallsCount()
    val leases = generation.externalLeases()
    val cronetActive = generation.activeCronetCalls()
    val traceIdentity = generation.retirementTraceIdentity
      ?: java.lang.Long.toHexString(generation.generation)
    val source = generation.retirementSource
    val diagnosticsEnabled = generation.retirementDiagnosticsEnabled
    if (diagnosticsEnabled && generation.shouldRecordDrainState(queued, running, leases, cronetActive)) {
      Log.i(
        LOG_TAG,
        "rotate-read-runtime phase=drain generation=" + generation.generation +
          " queued=" + queued + " running=" + running + " leases=" + leases + " cronetActive=" + cronetActive
      )
      ReadNetworkDiagnostics.record(
        linkedMapOf<String, Any>(
          "operation" to "rotate-read-runtime",
          "phase" to "drain",
          "traceIdentity" to traceIdentity,
          "generation" to generation.generation,
          "queuedCount" to queued,
          "runningCount" to running,
          "leaseCount" to leases,
          "cronetActiveCount" to cronetActive
        ).apply { if (source != null) put("source", source) }
      )
    }
    val shouldFinish = synchronized(lock) {
      if (retiredGenerations[generation.generation] !== generation) return
      if (!generation.isReadyToDrain(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()))) {
        false
      } else {
        generation.sealRetirement()
        retiredGenerations.remove(generation.generation, generation)
        true
      }
    }
    if (!shouldFinish) {
      scheduleDrain(generation)
      return
    }
    generation.finishRetirement()
    if (!diagnosticsEnabled) {
      Log.i(LOG_TAG, "discarded unpublished read runtime generation=" + generation.generation)
      return
    }
    markReadNetworkRuntimeDrained(traceIdentity, generation.generation, source)
  }

  private fun markReadNetworkRuntimeDrained(traceIdentity: String, generation: Long, source: String?) {
    val finish = synchronized(lock) {
      val pending = pendingRotationFinishes[traceIdentity] ?: return
      if (pending.retiredGeneration != generation || pending.source != source) return
      pending.drained = true
      if (!pending.applied) null else {
        pendingRotationFinishes.remove(traceIdentity)
        pending
      }
    }
    finish?.let(::recordReadNetworkRuntimeFinish)
  }

  private fun recordReadNetworkRuntimeFinish(pending: PendingReadRuntimeFinish) {
    Log.i(
      LOG_TAG,
      "rotate-read-runtime phase=finish generation=" + pending.retiredGeneration + " outcome=retired"
    )
    ReadNetworkDiagnostics.record(
      mapOf(
        "operation" to "rotate-read-runtime",
        "phase" to "finish",
        "traceIdentity" to pending.traceIdentity,
        "source" to pending.source,
        "generation" to pending.retiredGeneration,
        "outcome" to "retired"
      )
    )
  }

  private fun runtimeIdentityFields(generation: ReadNetworkRuntimeGeneration): String =
    "generation=" + generation.generation +
      " dispatcherId=" + opaqueNetworkIdentity(generation.dispatcher) +
      " forumPoolId=" + opaqueNetworkIdentity(generation.forumConnectionPool) +
      " mediaPoolId=" + opaqueNetworkIdentity(generation.mediaConnectionPool) +
      " imageClientId=" + opaqueNetworkIdentity(generation.imageClient)

  private fun runtimeIdentityDiagnosticFields(generation: ReadNetworkRuntimeGeneration): Map<String, Any> =
    mapOf(
      "generation" to generation.generation,
      "dispatcherId" to opaqueNetworkIdentity(generation.dispatcher),
      "forumPoolId" to opaqueNetworkIdentity(generation.forumConnectionPool),
      "mediaPoolId" to opaqueNetworkIdentity(generation.mediaConnectionPool),
      "imageClientId" to opaqueNetworkIdentity(generation.imageClient)
    )

  internal fun readNetworkDiagnosticEvents(): List<ReadNetworkDiagnosticEvent> =
    ReadNetworkDiagnostics.snapshot()

  internal fun managedCookieHeaderForUrl(url: String): String? =
    cookieHandler.readCookieHeader(url)

  internal fun supportsManagedCookieUrl(url: String): Boolean =
    isManagedCookieUrl(url)

  internal fun clearManagedLoginCookies(source: String, diagnostics: Map<String, Any> = emptyMap()): Boolean {
    if (source == "linuxdo") LinuxDoCookieResponses.store.setBarrier(true, "explicit-clear", diagnostics)
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

internal fun expoImageClient(client: OkHttpClient, generation: Long = 0L): OkHttpClient =
  client.newBuilder()
    .callTimeout(0, TimeUnit.MILLISECONDS)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .apply { networkInterceptors().add(0, ForumMediaCloudflareFallbackInterceptor(generation)) }
    .build()

private fun installExpoImageClient(context: Context, callFactory: Call.Factory) {
  DiagnosticJournal.recordStartupPhase("glide-start")
  val registry = Glide.get(context).registry
  DiagnosticJournal.recordStartupPhase("glide-ready")
  registry.replace(
    GlideUrl::class.java,
    InputStream::class.java,
    CloseSafeGlideUrlLoader.Factory(callFactory)
  )
  registry.replace(
    GlideUrlWrapper::class.java,
    InputStream::class.java,
    CloseSafeGlideUrlWrapperLoader.Factory(callFactory)
  )
  DiagnosticJournal.recordStartupPhase("image-loader-ready")
}

internal fun awaitImageLoaderInstallation(
  isMainThread: Boolean,
  timeoutMs: Long = 5_000L,
  postToMainThread: ((() -> Unit) -> Boolean),
  publish: () -> Unit
) {
  if (isMainThread) {
    publish()
    return
  }
  val completed = CountDownLatch(1)
  val failure = AtomicReference<Throwable?>(null)
  val posted = postToMainThread {
    try {
      publish()
    } catch (error: Throwable) {
      failure.set(error)
    } finally {
      completed.countDown()
    }
  }
  if (!posted || !completed.await(timeoutMs, TimeUnit.MILLISECONDS)) {
    throw IllegalStateException("等待图片加载器初始化超时")
  }
  failure.get()?.let { error ->
    throw IllegalStateException("图片加载器初始化失败", error)
  }
}

private fun installExpoImageClientOnMainThread(context: Context, callFactory: Call.Factory) {
  awaitImageLoaderInstallation(
    Looper.myLooper() == Looper.getMainLooper(),
    postToMainThread = { action -> Handler(Looper.getMainLooper()).post(action) },
    publish = { installExpoImageClient(context, callFactory) }
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
  private val idleTimeoutMs: Int = PROXY_IDLE_TIMEOUT_MS,
  private val socketConnector: (Socket, String, Int) -> Unit = { socket, host, port ->
    socket.connect(InetSocketAddress(host, port), 15_000)
  },
  private val tlsConnectionFactory: (Socket, String, Int) -> ProxyTlsConnection =
    ::createPlatformProxyTlsConnection
) {
  private val serverSocket = ServerSocket(0, MAX_PROXY_CONNECTIONS, InetAddress.getByName("127.0.0.1"))
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

  init {
    require(maxConnections > 0)
    require(idleTimeoutMs > 0)
  }

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
      synchronized(socketLock) {
        sockets.remove(socket)
      }
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
          val request = parseLocalProxyRequest(header)
          if (request.method == "CONNECT") {
            val remote = connectToTarget(request.target)
            try {
              local.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray(HEADER_CHARSET))
              pipeBoth(local, remote, copyExecutor, idleTimeoutMs)
            } finally {
              closeOwned(remote)
            }
            return
          }

          val remote = if (upstream.protocol == "http") {
            connectPlainOwned(upstream.host, upstream.port)
          } else {
            connectViaSocks5(request.target)
          }
          try {
            val outboundHeader = if (upstream.protocol == "http") {
              headerWithHttpProxyAuthorization(header)
            } else {
              originHeaderForDirectRequest(header, request)
            }
            remote.getOutputStream().write(outboundHeader.toByteArray(HEADER_CHARSET))
            pipeBoth(local, remote, copyExecutor, idleTimeoutMs, request.contentLength)
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
      synchronized(socketLock) {
        sockets.remove(client)
      }
    }
  }

  private fun connectToTarget(target: ProxyTarget): Socket =
    if (upstream.protocol == "http") connectViaHttpProxy(target) else connectViaSocks5(target)

  private fun connectViaHttpProxy(target: ProxyTarget): Socket {
    val socket = connectPlainOwned(upstream.host, upstream.port)
    try {
      socket.soTimeout = 15_000
      val builder = StringBuilder()
      val authorityHost = if (target.host.contains(":")) "[" + target.host + "]" else target.host
      builder.append("CONNECT ").append(authorityHost).append(":").append(target.port).append(" HTTP/1.1\r\n")
      builder.append("Host: ").append(authorityHost).append(":").append(target.port).append("\r\n")
      httpProxyAuthorizationHeader()?.let { builder.append(it).append("\r\n") }
      builder.append("Proxy-Connection: Keep-Alive\r\n\r\n")
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
    val lines = header.trimEnd().split("\r\n")
    val builder = StringBuilder()
    lines.forEachIndexed { index, line ->
      if (
        index == 0
        || (
          !line.startsWith("Proxy-Authorization:", ignoreCase = true)
          && !isPersistentConnectionHeader(line)
        )
      ) {
        builder.append(line).append("\r\n")
      }
    }
    httpProxyAuthorizationHeader()?.let { builder.append(it).append("\r\n") }
    builder.append("Connection: close\r\n")
    builder.append("Proxy-Connection: close\r\n")
    builder.append("\r\n")
    return builder.toString()
  }

  private fun originHeaderForDirectRequest(header: String, request: LocalProxyRequest): String {
    val requestPath = originRequestPath(request.requestTarget)
    val lines = header.trimEnd().split("\r\n")
    val builder = StringBuilder()
    builder.append(request.method).append(" ").append(requestPath).append(" ").append(request.version).append("\r\n")
    var hasHost = false
    lines.drop(1).forEach { line ->
      if (line.startsWith("Proxy-", ignoreCase = true) || isPersistentConnectionHeader(line)) {
        return@forEach
      }
      if (line.startsWith("Host:", ignoreCase = true)) {
        hasHost = true
      }
      builder.append(line).append("\r\n")
    }
    if (!hasHost) {
      builder.append("Host: ").append(request.target.host).append("\r\n")
    }
    builder.append("Connection: close\r\n")
    builder.append("\r\n")
    return builder.toString()
  }

  private fun isPersistentConnectionHeader(line: String): Boolean =
    line.startsWith("Connection:", ignoreCase = true)
      || line.startsWith("Keep-Alive:", ignoreCase = true)
      || line.startsWith("Proxy-Connection:", ignoreCase = true)

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
          ("GET /generate_204 HTTP/1.1\r\n"
            + "Host: " + host + "\r\n"
            + "Connection: close\r\n\r\n").toByteArray(HEADER_CHARSET)
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
private val IPV4_PATTERN = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
private val HTTP_REQUEST_LINE_PATTERN = Regex("^([A-Za-z]+) ([^\\s]+) (HTTP/1\\.[01])$")
private val HTTP_HEADER_NAME_PATTERN = Regex("^[A-Za-z0-9_-]+$")

internal fun readHeaderBlock(input: InputStream): String {
  val buffer = ByteArrayOutputStream()
  var matched = 0
  while (buffer.size() < 64 * 1024) {
    val value = input.read()
    if (value < 0) {
      throw EOFException("Connection closed")
    }
    buffer.write(value)
    matched = when {
      matched == 0 && value == '\r'.code -> 1
      matched == 1 && value == '\n'.code -> 2
      matched == 2 && value == '\r'.code -> 3
      matched == 3 && value == '\n'.code -> 4
      value == '\r'.code -> 1
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
  val status = Regex("^HTTP/\\d(?:\\.\\d)?\\s+(\\d{3})(?:\\s|$)")
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

internal fun parseLocalProxyRequest(header: String): LocalProxyRequest {
  if (!header.endsWith("\r\n\r\n")) {
    throw IllegalArgumentException("Incomplete proxy request")
  }
  val lines = header.removeSuffix("\r\n\r\n").split("\r\n")
  val match = HTTP_REQUEST_LINE_PATTERN.matchEntire(lines.firstOrNull().orEmpty())
    ?: throw IllegalArgumentException("Invalid proxy request line")
  val method = match.groupValues[1].uppercase(Locale.US)
  val requestTarget = match.groupValues[2]
  val version = match.groupValues[3]
  val headerLines = lines.drop(1)
  val hostHeader = singleHostHeader(headerLines)
  var contentLength = 0L
  val target = if (method == "CONNECT") {
    val connectTarget = parseStrictAuthority(requestTarget, 443, requireExplicitPort = true)
    if (parseStrictAuthority(hostHeader, 443, requireExplicitPort = false) != connectTarget) {
      throw IllegalArgumentException("CONNECT target and Host differ")
    }
    connectTarget
  } else {
    contentLength = fixedRequestContentLength(headerLines)
    val uri = try {
      URI(requestTarget)
    } catch (error: Exception) {
      throw IllegalArgumentException("Invalid HTTP proxy target", error)
    }
    if (
      !uri.scheme.equals("http", ignoreCase = true)
      || uri.rawAuthority.isNullOrBlank()
      || uri.rawUserInfo != null
      || uri.rawAuthority.contains("@")
      || uri.rawFragment != null
    ) {
      throw IllegalArgumentException("Only absolute HTTP proxy targets are allowed")
    }
    val targetHost = uri.host ?: throw IllegalArgumentException("HTTP target host is missing")
    val httpTarget = ProxyTarget(normalizePublicTargetHost(targetHost), if (uri.port == -1) 80 else uri.port)
    if (httpTarget.port != 80) {
      throw IllegalArgumentException("Plain HTTP proxy target must use port 80")
    }
    if (parseStrictAuthority(hostHeader, 80, requireExplicitPort = false) != httpTarget) {
      throw IllegalArgumentException("HTTP target and Host differ")
    }
    httpTarget
  }
  return LocalProxyRequest(method, requestTarget, version, target, contentLength)
}

private fun fixedRequestContentLength(lines: List<String>): Long {
  var contentLength: String? = null
  for (line in lines) {
    val separator = line.indexOf(':')
    val name = line.substring(0, separator)
    val value = line.substring(separator + 1).trim()
    if (name.equals("Transfer-Encoding", ignoreCase = true)) {
      throw IllegalArgumentException("Transfer-Encoding is not allowed")
    }
    if (name.equals("Content-Length", ignoreCase = true)) {
      if (contentLength != null) {
        throw IllegalArgumentException("Multiple Content-Length headers are not allowed")
      }
      contentLength = value
    }
  }
  val value = contentLength ?: return 0
  if (value.isEmpty() || !value.all(Char::isDigit)) {
    throw IllegalArgumentException("Invalid Content-Length")
  }
  return value.toLongOrNull()
    ?: throw IllegalArgumentException("Invalid Content-Length")
}

private fun singleHostHeader(lines: List<String>): String {
  val hosts = mutableListOf<String>()
  for (line in lines) {
    val separator = line.indexOf(':')
    if (separator <= 0 || !HTTP_HEADER_NAME_PATTERN.matches(line.substring(0, separator))) {
      throw IllegalArgumentException("Invalid proxy header")
    }
    val value = line.substring(separator + 1).trim()
    if (value.any { character ->
        (character.code < 0x20 && character != '\t') || character.code == 0x7f
      }) {
      throw IllegalArgumentException("Invalid proxy header value")
    }
    if (line.substring(0, separator).equals("Host", ignoreCase = true)) {
      hosts.add(value)
    }
  }
  if (hosts.size != 1) {
    throw IllegalArgumentException("Exactly one Host header is required")
  }
  return hosts.single()
}

private fun parseStrictAuthority(
  value: String,
  expectedPort: Int,
  requireExplicitPort: Boolean
): ProxyTarget {
  if (
    value.isBlank()
    || value != value.trim()
    || value.contains("@")
    || value.any { it.code <= 0x20 || it.code == 0x7f }
  ) {
    throw IllegalArgumentException("Invalid proxy authority")
  }
  val (host, portText) = if (value.startsWith("[")) {
    val close = value.indexOf(']')
    if (close <= 1 || value.indexOf(']', close + 1) >= 0) {
      throw IllegalArgumentException("Invalid IPv6 authority")
    }
    val remainder = value.substring(close + 1)
    if (remainder.isNotEmpty() && !remainder.startsWith(":")) {
      throw IllegalArgumentException("Invalid IPv6 authority")
    }
    value.substring(1, close) to remainder.removePrefix(":").ifEmpty { null }
  } else {
    val firstColon = value.indexOf(':')
    val lastColon = value.lastIndexOf(':')
    if (firstColon != lastColon) {
      throw IllegalArgumentException("IPv6 authorities must use brackets")
    }
    if (firstColon < 0) value to null else value.substring(0, firstColon) to value.substring(firstColon + 1)
  }
  if (requireExplicitPort && portText == null) {
    throw IllegalArgumentException("Proxy authority port is required")
  }
  val port = portText?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }?.toIntOrNull()
    ?: if (portText == null) expectedPort else throw IllegalArgumentException("Invalid proxy authority port")
  if (port != expectedPort) {
    throw IllegalArgumentException("Proxy authority port is not allowed")
  }
  return ProxyTarget(normalizePublicTargetHost(host), port)
}

private fun normalizePublicTargetHost(host: String): String {
  val clean = stripIpv6Brackets(host)
  if (
    clean.isBlank()
    || clean != clean.trim()
    || clean.contains("@")
    || clean.contains("%")
    || clean.any { it.code <= 0x20 || it.code == 0x7f }
  ) {
    throw IllegalArgumentException("Invalid proxy target host")
  }
  val literal = when {
    IPV4_PATTERN.matches(clean) -> {
      val parts = clean.split(".")
      if (parts.any { part -> part.length > 1 && part.startsWith("0") }) {
        throw IllegalArgumentException("Non-canonical IPv4 target")
      }
      val octets = parts.map { part ->
        part.toIntOrNull()?.takeIf { it in 0..255 }
          ?: throw IllegalArgumentException("Invalid IPv4 target")
      }
      InetAddress.getByAddress(octets.map(Int::toByte).toByteArray())
    }
    clean.all { it.isDigit() || it == '.' } ->
      throw IllegalArgumentException("Invalid IPv4 target")
    clean.contains(":") -> try {
      InetAddress.getByName(clean)
    } catch (error: Exception) {
      throw IllegalArgumentException("Invalid IPv6 target", error)
    }
    else -> null
  }
  if (literal != null) {
    val bytes = literal.address
    val hasIpv4CompatiblePrefix =
      bytes.size == 16 && (0 until 12).all { index -> bytes[index] == 0.toByte() }
    val hasIpv4MappedPrefix =
      bytes.size == 16
        && (0 until 10).all { index -> bytes[index] == 0.toByte() }
        && bytes[10] == 0xff.toByte()
        && bytes[11] == 0xff.toByte()
    val isIpv4EmbeddedIpv6 = clean.contains(":") && (
      bytes.size == 4
        || hasIpv4CompatiblePrefix
        || hasIpv4MappedPrefix
      )
    if (isIpv4EmbeddedIpv6) {
      throw IllegalArgumentException("IPv4-embedded IPv6 proxy targets are not allowed")
    }
    val isUniqueLocalIpv6 = bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc
    if (
      literal.isAnyLocalAddress
      || literal.isLoopbackAddress
      || literal.isSiteLocalAddress
      || literal.isLinkLocalAddress
      || literal.isMulticastAddress
      || isUniqueLocalIpv6
    ) {
      throw IllegalArgumentException("Local or private proxy targets are not allowed")
    }
    return clean.lowercase(Locale.US)
  }
  val ascii = try {
    IDN.toASCII(clean, IDN.USE_STD3_ASCII_RULES).lowercase(Locale.US).removeSuffix(".")
  } catch (error: Exception) {
    throw IllegalArgumentException("Invalid proxy target host", error)
  }
  if (
    ascii.isBlank()
    || ascii.length > 253
    || looksLikeNonCanonicalIpv4(ascii)
    || ascii == "localhost"
    || ascii.endsWith(".localhost")
    || ascii.split(".").any { label ->
      label.isEmpty() || label.length > 63 || label.startsWith("-") || label.endsWith("-")
    }
  ) {
    throw IllegalArgumentException("Invalid proxy target host")
  }
  return ascii
}

private fun looksLikeNonCanonicalIpv4(host: String): Boolean {
  val parts = host.split(".")
  return parts.size in 1..4
    && parts.all { part ->
      part.matches(Regex("^\\d+$"))
        || part.matches(Regex("^0[xX][0-9A-Fa-f]+$"))
    }
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
  val header = "HTTP/1.1 " + status + " " + message + "\r\nConnection: close\r\nContent-Length: " + body.size + "\r\n\r\n"
  output.write(header.toByteArray(HEADER_CHARSET))
  output.write(body)
}

internal fun pipeBoth(
  left: Socket,
  right: Socket,
  executor: ExecutorService,
  idleTimeoutMs: Int,
  leftByteLimit: Long? = null
) {
  right.use { remote ->
    val idleDeadline = TunnelIdleDeadline(idleTimeoutMs)
    val latch = CountDownLatch(2)
    fun closeTunnel() {
      try {
        left.close()
      } catch (_: IOException) {
      }
      try {
        remote.close()
      } catch (_: IOException) {
      }
    }
    fun submitCopy(copy: () -> Unit) {
      try {
        executor.execute {
          try {
            copy()
          } catch (_: SocketTimeoutException) {
            closeTunnel()
          } catch (_: IOException) {
            closeTunnel()
          } finally {
            latch.countDown()
          }
        }
      } catch (_: RejectedExecutionException) {
        closeTunnel()
        latch.countDown()
      }
    }
    submitCopy {
      copySocket(left, remote, idleDeadline, leftByteLimit)
    }
    submitCopy {
      copySocket(remote, left, idleDeadline)
    }
    try {
      while (latch.count > 0) {
        val waitTimeoutMs = idleDeadline.remainingTimeoutMs()
        if (latch.await(waitTimeoutMs.toLong(), TimeUnit.MILLISECONDS)) break
      }
    } catch (_: SocketTimeoutException) {
      closeTunnel()
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      closeTunnel()
    }
  }
}

private class TunnelIdleDeadline(idleTimeoutMs: Int) {
  private val timeoutNanos = TimeUnit.MILLISECONDS.toNanos(idleTimeoutMs.toLong())
  private val lastActivityNanos = AtomicLong(System.nanoTime())

  fun recordActivity() {
    val now = System.nanoTime()
    while (true) {
      val previous = lastActivityNanos.get()
      if (now <= previous || lastActivityNanos.compareAndSet(previous, now)) {
        return
      }
    }
  }

  @Throws(SocketTimeoutException::class)
  fun remainingTimeoutMs(): Int {
    val elapsedNanos = System.nanoTime() - lastActivityNanos.get()
    val remainingNanos = timeoutNanos - elapsedNanos
    if (remainingNanos <= 0) {
      throw SocketTimeoutException("Proxy tunnel idle timeout")
    }
    return ((remainingNanos + 999_999L) / 1_000_000L)
      .coerceIn(1L, Int.MAX_VALUE.toLong())
      .toInt()
  }
}

@Throws(IOException::class)
private fun copySocket(
  inputSocket: Socket,
  outputSocket: Socket,
  idleDeadline: TunnelIdleDeadline,
  byteLimit: Long? = null
) {
  val input = inputSocket.getInputStream()
  val output = outputSocket.getOutputStream()
  try {
    val buffer = ByteArray(16 * 1024)
    var remaining = byteLimit
    while (remaining == null || remaining > 0) {
      val read = try {
        inputSocket.soTimeout = idleDeadline.remainingTimeoutMs()
        input.read(
          buffer,
          0,
          remaining?.coerceAtMost(buffer.size.toLong())?.toInt() ?: buffer.size
        )
      } catch (_: SocketTimeoutException) {
        inputSocket.soTimeout = idleDeadline.remainingTimeoutMs()
        continue
      }
      if (read < 0) {
        if (remaining != null) {
          throw EOFException("Request body ended before Content-Length")
        }
        break
      }
      if (read == 0) continue
      idleDeadline.recordActivity()
      output.write(buffer, 0, read)
      output.flush()
      if (remaining != null) {
        remaining -= read
      }
    }
  } finally {
    // Content-Length completes an HTTP request; keep its socket open for the response.
    if (byteLimit == null) {
      try {
        outputSocket.shutdownOutput()
      } catch (_: IOException) {
      }
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
