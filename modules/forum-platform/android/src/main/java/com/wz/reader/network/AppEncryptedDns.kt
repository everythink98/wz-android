package com.wz.reader

import android.os.Build
import java.io.Closeable
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.SocketException
import java.net.UnknownHostException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLException
import kotlin.time.Duration
import okhttp3.Cache
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Connection
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.Dns
import okhttp3.DnsCache
import okhttp3.EventListener
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.dnsoverhttps.DnsOverHttps
import okio.Buffer
import okio.ByteString

sealed interface AppNetworkRoute

internal data class EncryptedDnsServer(
  val endpoint: HttpUrl,
  val bootstrap: List<InetAddress>,
  val id: String? = null
)

internal data class EncryptedDnsConfig(
  val servers: List<EncryptedDnsServer>,
  val allowFallback: Boolean
) : AppNetworkRoute {
  init { require(servers.isNotEmpty()) }
}

internal enum class DnsRouteResult(val value: String, val description: String) {
  ENCRYPTED("encrypted", "已使用加密 DNS"),
  SYSTEM_DNS("system-dns", "加密 DNS 服务暂不可用，已使用系统 DNS"),
  SYSTEM_PROXY("system-proxy", "该连接由系统代理解析"),
  PROXY_CONFLICT("proxy-conflict", "仅 DoH 模式与当前目标的系统代理冲突"),
  TLS_FAILURE("tls-failure", "加密 DNS 服务的 TLS 校验失败"),
  DNS_FAILURE("dns-failure", "加密 DNS 解析失败"),
  SITE_FAILURE("site-failure", "论坛 HTTPS 直连暂不可用")
}

internal class EncryptedDnsFailure(val result: DnsRouteResult, cause: Throwable? = null) :
  UnknownHostException(result.description) {
  init { if (cause != null) initCause(cause) }
}

private class DohServiceUnavailable(cause: IOException? = null) : IOException("DoH service unavailable", cause)

private const val DOH_PROBE_HOST = "example.com"
private const val DOH_LOOKUP_BUDGET_MS = 4_000L
private const val AUTO_DOH_ATTEMPT_MS = 1_250L
private const val AUTO_DOH_COOLDOWN_MS = 30_000L
private const val FORUM_PAGE_TIMEOUT_MS = 2_000L
private const val FORUM_PROBE_WINDOW_MS = DOH_LOOKUP_BUDGET_MS + FORUM_PAGE_TIMEOUT_MS
private val forumDohHosts = setOf(
  "linux.do", "www.linux.do", "v2ex.com", "www.v2ex.com",
  "nodeseek.com", "www.nodeseek.com", "yaohuo.me", "www.yaohuo.me"
)

private data class EncryptedDnsQuery(val hostname: String, val echPort: Int? = null)

private data class EncryptedDnsAnswer(val records: List<Dns.Record>, val provider: String?)

internal enum class ForumDohReachability { UNREACHABLE, TCP_CONNECTED, TLS_CONNECTED, RESPONDED, OPEN }

internal data class ForumDohResponse(val code: Int, val challenge: Boolean) {
  val open get() = code in 200..299 && !challenge
}

internal data class ForumDohProbe(
  val reachability: ForumDohReachability, val address: InetAddress? = null, val response: ForumDohResponse? = null
)

internal object ForumDohFailoverInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response =
    NetworkProxyRuntime.currentEncryptedDns()?.interceptForumRequest(chain) ?: chain.proceed(chain.request())
}

internal fun Response.forumDohResponse() =
  ForumDohResponse(code, header("cf-mitigated").equals("challenge", ignoreCase = true))

private fun List<Dns.Record>.addresses(): List<InetAddress> =
  filterIsInstance<Dns.Record.IpAddress>().map { it.address }

private fun List<Dns.Record>.preferAddress(address: InetAddress?): List<Dns.Record> {
  if (address == null) return this
  val index = indexOfFirst { it is Dns.Record.IpAddress && it.address == address }
  return if (index <= 0) this else listOf(this[index]) + filterIndexed { position, _ -> position != index }
}

private class ForumProbeDns(private val hostname: String, private val records: List<Dns.Record>) : Dns {
  override fun lookup(hostname: String): List<InetAddress> {
    if (hostname != this.hostname) throw UnknownHostException(hostname)
    return records.addresses()
  }

  override fun newCall(request: Dns.Request): Dns.Call {
    if (request.hostname != hostname || records.none { it is Dns.Record.ServiceMetadata }) return super.newCall(request)
    return object : Dns.Call {
      override val request = request
      private val canceled = AtomicBoolean()
      override fun enqueue(callback: Dns.Callback) {
        if (canceled.get()) callback.onFailure(this, IOException("DNS call canceled"))
        else callback.onRecords(this, true, records)
      }
      override fun cancel() { canceled.set(true) }
      override fun isCanceled(): Boolean = canceled.get()
    }
  }
}

private fun <T> awaitDnsResult(future: CompletableFuture<T>): T = try {
  future.get()
} catch (error: ExecutionException) {
  throw error.cause ?: error
} catch (error: InterruptedException) {
  Thread.currentThread().interrupt()
  throw IOException("已取消域名解析", error)
}

private fun Dns.Call.awaitRecords(): List<Dns.Record> {
  val result = CompletableFuture<List<Dns.Record>>()
  val received = mutableListOf<Dns.Record>()
  enqueue(object : Dns.Callback {
    override fun onRecords(call: Dns.Call, last: Boolean, records: List<Dns.Record>) {
      received += records
      if (last) result.complete(received)
    }

    override fun onFailure(call: Dns.Call, e: IOException) {
      if (received.any { it is Dns.Record.IpAddress }) result.complete(received)
      else result.completeExceptionally(e)
    }
  })
  return try {
    awaitDnsResult(result)
  } finally {
    if (!result.isDone) cancel()
  }
}

private fun dohTransportError(error: IOException): IOException = when (error) {
  is SocketException, is InterruptedIOException, is EOFException, is UnknownHostException -> DohServiceUnavailable(error)
  else -> error
}

// Read only RR lifetimes. Address decoding remains in OkHttp's DnsOverHttps.
private fun dnsTtlSeconds(wire: ByteArray): Int? {
  val data = Buffer().write(wire)
  fun u16() = data.readShort().toInt() and 0xffff
  fun ttl() = data.readInt().coerceAtLeast(0)
  fun skipName() {
    while (true) {
      val size = data.readByte().toInt() and 0xff
      when {
        size == 0 -> return
        size < 64 -> data.skip(size.toLong())
        size >= 192 -> {
          data.skip(1)
          return
        }
        else -> throw IOException("Invalid DNS name")
      }
    }
  }
  return try {
    data.skip(2)
    val flags = u16()
    if (flags and 0xfa0f != 0x8000 || u16() != 1) return null
    val answers = u16()
    val authorities = u16()
    data.skip(2)
    skipName()
    data.skip(4)
    var shortest: Int? = null
    repeat(if (answers > 0) answers else authorities) {
      skipName()
      val type = u16()
      val recordClass = u16()
      val lifetime = ttl()
      val length = u16().toLong()
      if (answers > 0) {
        shortest = minOf(shortest ?: lifetime, lifetime)
      } else if (type == 6 && recordClass == 1) {
        val endSize = data.size - length
        skipName()
        skipName()
        if (data.size - endSize != 20L) return null
        data.skip(16)
        return minOf(lifetime, ttl())
      }
      data.skip(length)
    }
    shortest
  } catch (_: IOException) {
    null
  }
}

private fun Response.withDnsFreshness(): Response {
  if (!isSuccessful || body?.contentType()?.let { it.type == "application" && it.subtype == "dns-message" } != true ||
    header("Content-Encoding") != null || header("Expires") != null ||
    cacheControl.maxAgeSeconds >= 0 || cacheControl.noStore || cacheControl.noCache) return this
  val wire = try {
    peekBody(65_536L).bytes()
  } catch (error: IOException) {
    close()
    throw error
  }
  if (wire.size !in 12..65_535) return this
  val ttl = dnsTtlSeconds(wire) ?: return this
  return newBuilder().addHeader("Cache-Control", "max-age=" + ttl).build()
}

private fun Response.retryAfterMillis(): Long? {
  val value = header("Retry-After")?.trim() ?: return null
  if (value.isNotEmpty() && value.all { it in '0'..'9' }) {
    return TimeUnit.SECONDS.toMillis(value.toLongOrNull() ?: Long.MAX_VALUE)
  }
  val until = headers.getDate("Retry-After") ?: return null
  return until.time - (headers.getDate("Date")?.time ?: System.currentTimeMillis())
}

private val initializedCacheRoots = mutableSetOf<File>()

@Synchronized private fun openDnsCache(root: File): Cache {
  if (initializedCacheRoots.add(root)) {
    root.listFiles { directory -> directory.isDirectory && directory.name.startsWith("dns-") }
      ?.forEach { it.deleteRecursively() }
  }
  return Cache(File(root, "dns-${UUID.randomUUID()}"), 1024L * 1024L)
}

internal class AppEncryptedDns(
  private val config: EncryptedDnsConfig,
  private val cacheRoot: File?,
  private val systemDns: Dns = Dns.SYSTEM,
  private val onResult: (DnsRouteResult, String?) -> Unit = { _, _ -> },
  private val includeIpv6: () -> Boolean = { true },
  private val enableEch: Boolean = Build.VERSION.SDK_INT >= 24,
  private val monotonicMillis: () -> Long = { TimeUnit.NANOSECONDS.toMillis(System.nanoTime()) },
  private val onClose: () -> Unit = {},
  private val probeForum: ((HttpUrl, Dns) -> ForumDohProbe)? = null,
  clientBuilder: () -> OkHttpClient.Builder = { OkHttpClient.Builder() }
) : Dns, Closeable {
  private val automatic = config.servers.size > 1

  private val dnsCalls = Executors.newCachedThreadPool { task ->
    Thread(task, "wz-encrypted-dns").apply { isDaemon = true }
  }

  private inner class Resolver(val server: EncryptedDnsServer, private val ipv6: Boolean) {
    private val cache = cacheRoot?.let(::openDnsCache)
    private val retryAfterMs = AtomicLong(Long.MIN_VALUE)
    private val generalRetryAfterMs = AtomicLong(Long.MIN_VALUE)
    @Volatile private var closed = false
    @Volatile var probeRejection: EncryptedDnsFailure? = null
    private val client = buildClient()
      .proxy(Proxy.NO_PROXY)
      .dispatcher(Dispatcher())
      .connectionPool(ConnectionPool())
      .cache(cache)
      .followRedirects(false)
      .followSslRedirects(false)
      .addNetworkInterceptor { chain -> chain.proceed(chain.request()).withDnsFreshness() }
      .addInterceptor { chain ->
        if (closed) throw IOException("设备网络已切换")
        val response = try {
          chain.proceed(chain.request())
        } catch (error: IOException) {
          throw dohTransportError(error)
        }
        if (response.code == 429 || response.code == 503) {
          response.retryAfterMillis()?.takeIf { it > 0 }?.let(::coolDown)
        }
        if (response.code == 429 || response.code in 500..599) {
          if (automatic && response.networkResponse != null) coolDown(AUTO_DOH_COOLDOWN_MS)
          response.close()
          throw DohServiceUnavailable()
        }
        if (response.isSuccessful) {
          val type = response.body?.contentType()
          if (type?.type != "application" || type.subtype != "dns-message") {
            response.close()
            throw IOException("Invalid DoH response")
          }
          val header = try {
            response.peekBody(65_536L).bytes()
          } catch (error: IOException) {
            response.close()
            throw dohTransportError(error)
          }
          if (header.size !in 12..65_535) {
            response.close()
            throw IOException("Invalid DoH response size")
          }
          if (header[3].toInt() and 0x0f == 2) {
            response.close()
            throw DohServiceUnavailable()
          }
        }
        response
      }
      .build()
    // RFC 8484 defines HTTP freshness for DNS responses. Keep one small, route-local HTTP cache.
    private fun encryptedDns(forum: Boolean): DnsOverHttps {
      // Forum candidates race in parallel. General lookups reserve time for sequential alternatives.
      val fastAttempt = automatic && !forum
      val transport = client.newBuilder()
        .connectTimeout(if (fastAttempt) AUTO_DOH_ATTEMPT_MS else 2_000L, TimeUnit.MILLISECONDS)
        .callTimeout(if (fastAttempt) AUTO_DOH_ATTEMPT_MS else DOH_LOOKUP_BUDGET_MS, TimeUnit.MILLISECONDS)
        .addInterceptor { chain ->
          val request = chain.request()
          val selected = if (isCoolingDown(monotonicMillis(), general = !forum) && !request.cacheControl.onlyIfCached) {
            request.newBuilder().cacheControl(CacheControl.Builder().onlyIfCached().build()).build()
          } else request
          chain.proceed(selected)
        }.build()
      return DnsOverHttps.Builder()
        .client(transport)
        .url(server.endpoint)
        .systemDns(systemDns)
        .cache(DnsCache(Duration.ZERO, Duration.ZERO, Duration.ZERO, Duration.ZERO))
        .includeServiceMetadata(enableEch)
        .includeIPv6(ipv6)
        .apply { if (server.bootstrap.isNotEmpty()) bootstrapDnsHosts(server.bootstrap) }
        .build()
    }
    private val encrypted = encryptedDns(forum = false)
    private val forumDns by lazy { encryptedDns(forum = true) }

    fun isCoolingDown(now: Long, general: Boolean = false): Boolean =
      now < retryAfterMs.get() || (general && now < generalRetryAfterMs.get())

    fun coolDown(delay: Long, generalOnly: Boolean = false) {
      val deadline = monotonicMillis().coerceAtMost(Long.MAX_VALUE - delay) + delay
      (if (generalOnly) generalRetryAfterMs else retryAfterMs).accumulateAndGet(deadline, ::maxOf)
    }

    fun lookup(query: EncryptedDnsQuery, forum: Boolean = false): List<Dns.Record> {
      val host = query.hostname
      val dns = if (forum) forumDns else encrypted
      val records = try {
        if (query.echPort == null) dns.lookup(host).map { Dns.Record.IpAddress(host, it) }
        else dns.newCall(Dns.Request(host, query.echPort)).awaitRecords()
      } catch (error: IOException) {
        val failures = (listOf(error) + error.suppressed).map {
          if (it is UnknownHostException) it.cause ?: it else it
        }
        if (failures.any { it is SSLException || it.cause is SSLException }) {
          throw EncryptedDnsFailure(DnsRouteResult.TLS_FAILURE, error)
        }
        if (failures.all { it is DohServiceUnavailable || it is InterruptedIOException }) {
          throw DohServiceUnavailable(error)
        }
        throw EncryptedDnsFailure(DnsRouteResult.DNS_FAILURE, error)
      }
      val addresses = records.filterIsInstance<Dns.Record.IpAddress>().filter {
        (ipv6 || it.address !is Inet6Address) && isPublicResolvedAddress(it.address)
      }
      if (addresses.isEmpty()) throw EncryptedDnsFailure(DnsRouteResult.DNS_FAILURE)
      if (!forum) probeRejection = null
      val ech = records.filterIsInstance<Dns.Record.ServiceMetadata>().firstOrNull {
        it.hostname == host && it.echConfigList != null
      }?.let { Dns.Record.ServiceMetadata(host, echConfigList = it.echConfigList) }
      return if (ech == null) addresses else addresses + ech
    }

    fun close() {
      closed = true
      client.dispatcher.cancelAll()
      client.connectionPool.evictAll()
      cache?.let { local ->
        runCatching {
          local.delete()
          local.directory.delete()
        }
      }
    }
  }

  private val buildClient = clientBuilder
  @Volatile private var resolver: NetworkResolvers? = NetworkResolvers()

  private inner class ForumChoice(val candidate: Resolver, val probe: ForumDohProbe)

  private inner class ForumSite {
    @Volatile var choice: ForumChoice? = null
      private set
    private val rejected = ConcurrentHashMap<Resolver, Long>()

    fun rejected(candidate: Resolver): Boolean = (rejected[candidate] ?: Long.MIN_VALUE) > monotonicMillis()

    @Synchronized fun select(next: ForumChoice): Boolean {
      if (rejected(next.candidate)) return false
      choice = next
      return true
    }

    @Synchronized fun reject(expected: ForumChoice): Boolean {
      if (choice !== expected) return rejected(expected.candidate)
      rejected[expected.candidate] = monotonicMillis() + AUTO_DOH_COOLDOWN_MS
      choice = null
      return true
    }
  }

  private inner class NetworkResolvers {
    private val ipv6 = includeIpv6()
    private val servers = config.servers.map { Resolver(it, ipv6) }
    private val generalServers = servers.filter { it.server.id != "cfluxdo" }.ifEmpty { servers }
    val active = ConcurrentHashMap<EncryptedDnsQuery, CompletableFuture<List<Dns.Record>>>()
    private val tlsAnswers = object : LinkedHashMap<EncryptedDnsQuery, List<Dns.Record>>(16, 0.75f, true) {
      override fun removeEldestEntry(eldest: Map.Entry<EncryptedDnsQuery, List<Dns.Record>>) = size > 128
    }
    @Synchronized fun rememberTlsAnswer(query: EncryptedDnsQuery, records: List<Dns.Record>) {
      if (records.any { it is Dns.Record.ServiceMetadata }) tlsAnswers[query] = records else tlsAnswers.remove(query)
    }
    @Synchronized fun echFor(host: String, address: InetAddress, port: Int): ByteString? =
      tlsAnswers[EncryptedDnsQuery(host, port)]?.echForAddress(host, address)
    private val forumSites = ConcurrentHashMap<EncryptedDnsQuery, ForumSite>()
    private val forumClient = if (automatic) OkHttpClient.Builder()
      .proxy(Proxy.NO_PROXY)
      .cookieJar(CookieJar.NO_COOKIES)
      .followRedirects(false)
      .followSslRedirects(false)
      .connectionPool(ConnectionPool(0, 1, TimeUnit.MINUTES))
      .callTimeout(FORUM_PAGE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .build() else null
    private val preferred = AtomicReference<Resolver?>()
    private val healthy = CopyOnWriteArrayList<Resolver>()
    private val ready = CompletableFuture<Unit>()
    private val remaining = AtomicInteger(generalServers.size)
    private val probes = if (automatic) Executors.newFixedThreadPool(generalServers.size) else null

    @Synchronized private fun startSelection() {
      val executor = probes ?: return
      if (executor.isShutdown) return
      for (candidate in generalServers) {
        executor.execute {
          try {
            checkCurrent(this)
            candidate.lookup(EncryptedDnsQuery(DOH_PROBE_HOST))
            preferred.compareAndSet(null, candidate)
            healthy.add(candidate)
            ready.complete(Unit)
          } catch (error: EncryptedDnsFailure) {
            candidate.probeRejection = error
            candidate.coolDown(AUTO_DOH_COOLDOWN_MS, generalOnly = true)
          } catch (_: DohServiceUnavailable) {
            candidate.coolDown(AUTO_DOH_COOLDOWN_MS, generalOnly = true)
          } catch (_: IOException) {
            // A network change closes this selection round.
          } finally {
            if (remaining.decrementAndGet() == 0) ready.complete(Unit)
          }
        }
      }
      executor.shutdown()
    }

    private fun probe(url: HttpUrl, records: List<Dns.Record>): ForumDohProbe {
      val dns = ForumProbeDns(url.host, records)
      var reached = ForumDohReachability.UNREACHABLE
      var address: InetAddress? = null
      return try {
        probeForum?.let { return it(url, dns) }
        val client = checkNotNull(forumClient).newBuilder().dns(dns)
          .eventListener(object : EventListener() {
            override fun secureConnectStart(call: Call) {
              reached = maxOf(reached, ForumDohReachability.TCP_CONNECTED)
            }
            override fun connectionAcquired(call: Call, connection: Connection) {
              address = connection.route().socketAddress.address
              reached = ForumDohReachability.TLS_CONNECTED
            }
          }).build().withDohTls { host, ip, port ->
            if (port == url.port) records.echForAddress(host, ip) else null
          }
        client.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
          val page = response.forumDohResponse()
          ForumDohProbe(if (page.open) ForumDohReachability.OPEN else ForumDohReachability.RESPONDED, address, page)
        }
      } catch (error: IOException) {
        val untrusted = generateSequence<Throwable>(error) { it.cause }.any {
          it is javax.net.ssl.SSLPeerUnverifiedException || it is java.security.cert.CertificateException
        }
        if (untrusted) ForumDohProbe(ForumDohReachability.UNREACHABLE) else ForumDohProbe(reached, address)
      }
    }

    private fun chooseForum(query: EncryptedDnsQuery, site: ForumSite): EncryptedDnsAnswer? {
      val url = HttpUrl.Builder().scheme("https").host(query.hostname).build()
      val completions = ExecutorCompletionService<Pair<ForumChoice, EncryptedDnsAnswer>?>(dnsCalls)
      val routes = ConcurrentHashMap<Set<Dns.Record>, ForumDohProbe>()
      val candidates = servers.filterNot { site.rejected(it) || it.isCoolingDown(monotonicMillis()) }
      checkCurrent(this)
      val tasks = candidates.map { candidate ->
        completions.submit(Callable {
          checkCurrent(this)
          val records = try {
            candidate.lookup(query, forum = true)
          } catch (_: EncryptedDnsFailure) {
            return@Callable null
          } catch (_: DohServiceUnavailable) {
            candidate.coolDown(AUTO_DOH_COOLDOWN_MS)
            return@Callable null
          }
          checkCurrent(this)
          val probe = routes.computeIfAbsent(records.toSet()) { probe(url, records) }
          ForumChoice(candidate, probe) to
            EncryptedDnsAnswer(records.preferAddress(probe.address), candidate.server.id)
        })
      }
      val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(FORUM_PROBE_WINDOW_MS)
      var fallback: Pair<ForumChoice, EncryptedDnsAnswer>? = null
      try {
        for (completedIndex in tasks.indices) {
          val wait = deadline - System.nanoTime()
          if (wait <= 0) break
          val completed = completions.poll(wait, TimeUnit.NANOSECONDS) ?: break
          val result = completed.get() ?: continue
          checkCurrent(this)
          val (choice, answer) = result
          if (choice.probe.reachability == ForumDohReachability.OPEN && site.select(choice)) return answer
          if (fallback == null || choice.probe.reachability > fallback.first.probe.reachability) fallback = result
        }
        checkCurrent(this)
        return fallback?.takeIf { site.select(it.first) }?.second
      } catch (error: InterruptedException) {
        Thread.currentThread().interrupt()
        throw IOException("已取消论坛直连测试", error)
      } catch (error: ExecutionException) {
        throw error.cause ?: error
      } finally {
        tasks.forEach { it.cancel(true) }
      }
    }

    fun failureHandler(query: EncryptedDnsQuery): (() -> Boolean)? {
      val site = forumSites[query] ?: return null
      val choice = site.choice ?: return null
      return { resolver === this && site.reject(choice) }
    }

    fun selectedResponse(query: EncryptedDnsQuery): ForumDohResponse? = forumSites[query]?.choice?.probe?.response

    fun lookup(query: EncryptedDnsQuery): EncryptedDnsAnswer {
      if (!automatic) return EncryptedDnsAnswer(servers.single().lookup(query), null)
      val site = if (query.hostname in forumDohHosts && (query.echPort == null || query.echPort == 443))
        forumSites.computeIfAbsent(query) { ForumSite() } else null
      if (site != null) {
        val choice = site.choice
        if (choice != null) {
          val cacheOnly = choice.candidate.isCoolingDown(monotonicMillis())
          try {
            return EncryptedDnsAnswer(choice.candidate.lookup(query, forum = true).preferAddress(choice.probe.address), choice.candidate.server.id)
          } catch (_: DohServiceUnavailable) {
            if (!cacheOnly) choice.candidate.coolDown(AUTO_DOH_COOLDOWN_MS)
            site.reject(choice)
          } catch (_: EncryptedDnsFailure) {
            site.reject(choice)
          }
        }
        chooseForum(query, site)?.let { return it }
      }
      val started = monotonicMillis()
      startSelection()
      awaitDnsResult(ready)
      var failure: DohServiceUnavailable? = null
      val order = (listOfNotNull(preferred.get()) + healthy + generalServers).distinct()
      val (available, cooling) = order.partition { !it.isCoolingDown(monotonicMillis(), general = true) }
      for (candidate in available + cooling) {
        checkCurrent(this)
        if (site?.rejected(candidate) == true) continue
        val now = monotonicMillis()
        val cacheOnly = candidate.isCoolingDown(now, general = true)
        if (!cacheOnly && now - started > DOH_LOOKUP_BUDGET_MS - AUTO_DOH_ATTEMPT_MS) continue
        try {
          val records = candidate.lookup(query)
          if (!candidate.isCoolingDown(monotonicMillis(), general = true)) {
            val recent = preferred.get()
            if (recent == null || recent.isCoolingDown(monotonicMillis(), general = true)) preferred.compareAndSet(recent, candidate)
          }
          return EncryptedDnsAnswer(records, candidate.server.id)
        } catch (error: DohServiceUnavailable) {
          failure = error
          if (!cacheOnly) candidate.coolDown(AUTO_DOH_COOLDOWN_MS, generalOnly = true)
        }
      }
      generalServers.firstNotNullOfOrNull { it.probeRejection }?.let { throw it }
      if (site != null && servers.any(site::rejected)) throw EncryptedDnsFailure(DnsRouteResult.SITE_FAILURE)
      throw failure ?: DohServiceUnavailable()
    }

    @Synchronized fun close() {
      ready.completeExceptionally(IOException("设备网络已切换"))
      probes?.shutdownNow()
      forumClient?.dispatcher?.cancelAll()
      forumClient?.connectionPool?.evictAll()
      servers.forEach { it.close() }
    }
  }

  override fun lookup(hostname: String): List<InetAddress> {
    if (isLocalDevHost(hostname)) return systemDns.lookup(hostname)
    val key = hostname.lowercase(Locale.ROOT).removeSuffix(".")
    val current = resolver ?: throw IOException("网络设置已切换")
    if (':' in key || key.matches(Regex("\\d{1,3}(\\.\\d{1,3}){3}"))) {
      val address = InetAddress.getByName(key)
      if (!isPublicResolvedAddress(address)) throw EncryptedDnsFailure(DnsRouteResult.DNS_FAILURE)
      return listOf(address)
    }
    return resolve(EncryptedDnsQuery(key), current).addresses()
  }

  fun forumTunnelFailure(host: String, port: Int): (() -> Boolean)? =
    if (port == 443) resolver?.failureHandler(EncryptedDnsQuery(host)) else null

  fun echFor(host: String, address: InetAddress, port: Int): ByteString? = resolver?.echFor(host, address, port)

  // A manual test owns a fresh resolver. Its selection GET already measured the requested homepage.
  fun measureForumSelection(url: HttpUrl): ForumDohResponse? {
    if (!automatic || !url.isHttps || url.port != 443 || url.host !in forumDohHosts || url.encodedPath != "/" ||
      url.encodedQuery != null) return null
    val current = resolver ?: throw IOException("网络设置已切换")
    val query = EncryptedDnsQuery(url.host, if (enableEch) url.port else null)
    resolve(query, current)
    return current.selectedResponse(query)
  }

  fun interceptForumRequest(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val current = resolver
    val url = request.url
    if (!automatic || current == null || !url.isHttps || url.port != 443 || url.host !in forumDohHosts)
      return chain.proceed(request)

    val call = chain.call()
    val failure = AtomicReference<(() -> Boolean)?>(null)
    val connectFailed = AtomicBoolean()
    val requestStarted = AtomicBoolean()
    call.addEventListener(object : EventListener() {
      override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
        if (domainName == url.host)
          failure.set(current.failureHandler(EncryptedDnsQuery(url.host, if (enableEch) url.port else null)))
      }

      override fun connectFailed(call: Call, address: InetSocketAddress, proxy: Proxy, protocol: Protocol?, ioe: IOException) {
        if (proxy.type() == Proxy.Type.DIRECT) connectFailed.set(true)
      }

      override fun requestHeadersStart(call: Call) { requestStarted.set(true) }
    })
    return try {
      chain.proceed(request)
    } catch (error: IOException) {
      if (!call.isCanceled() && connectFailed.get() && !requestStarted.get() && failure.get()?.invoke() == true &&
        request.method in setOf("GET", "HEAD")) chain.proceed(request)
      else throw error
    }
  }

  override fun newCall(request: Dns.Request): Dns.Call {
    if (!enableEch || isLocalDevHost(request.hostname)) return super.newCall(request)
    return object : Dns.Call {
      override val request = request
      private val result = CompletableFuture<List<Dns.Record>>()
      private val enqueued = AtomicBoolean()

      override fun enqueue(callback: Dns.Callback) {
        check(enqueued.compareAndSet(false, true)) { "DNS call already enqueued" }
        result.whenComplete { records, failure ->
          if (failure == null) callback.onRecords(this, true, records)
          else callback.onFailure(this, failure as? IOException ?: IOException("DNS call failed", failure))
        }
        val current = resolver
        if (current == null) {
          result.completeExceptionally(IOException("网络设置已切换"))
          return
        }
        try {
          dnsCalls.execute {
            if (result.isCancelled) return@execute
            try {
              result.complete(resolve(EncryptedDnsQuery(request.hostname.removeSuffix("."), request.port), current))
            } catch (error: Exception) {
              result.completeExceptionally(error)
            }
          }
        } catch (error: RejectedExecutionException) {
          result.completeExceptionally(IOException("网络设置已切换", error))
        }
      }

      override fun cancel() { result.cancel(false) }

      override fun isCanceled(): Boolean = result.isCancelled
    }
  }

  private fun resolve(query: EncryptedDnsQuery, current: NetworkResolvers): List<Dns.Record> {
    checkCurrent(current)
    val lookup = CompletableFuture<List<Dns.Record>>()
    val pending = current.active.putIfAbsent(query, lookup)
    if (pending != null) {
      val records = awaitDnsResult(pending)
      checkCurrent(current)
      return records
    }
    try {
      var result = DnsRouteResult.ENCRYPTED
      val answer = try {
        current.lookup(query)
      } catch (error: EncryptedDnsFailure) {
        report(current, error.result)
        throw error
      } catch (error: DohServiceUnavailable) {
        if (!config.allowFallback) {
          report(current, DnsRouteResult.DNS_FAILURE)
          throw EncryptedDnsFailure(DnsRouteResult.DNS_FAILURE, error)
        }
        checkCurrent(current)
        result = DnsRouteResult.SYSTEM_DNS
        try {
          val addresses = systemDns.lookup(query.hostname).filter(::isPublicResolvedAddress)
          EncryptedDnsAnswer(addresses.map { Dns.Record.IpAddress(query.hostname, it) }, null)
        } catch (error: UnknownHostException) {
          report(current, DnsRouteResult.DNS_FAILURE)
          throw error
        }
      }
      checkCurrent(current)
      if (answer.records.isEmpty()) {
        report(current, DnsRouteResult.DNS_FAILURE)
        throw EncryptedDnsFailure(DnsRouteResult.DNS_FAILURE)
      }
      if (query.echPort != null && Build.VERSION.SDK_INT < 37) current.rememberTlsAnswer(query, answer.records)
      report(current, result, answer.provider)
      lookup.complete(answer.records)
      return answer.records
    } catch (error: Throwable) {
      lookup.completeExceptionally(error)
      throw error
    } finally {
      current.active.remove(query, lookup)
    }
  }

  fun systemProxy(select: () -> Proxy?): Proxy? {
    val current = resolver ?: throw IOException("网络设置已切换")
    val proxy = select()
    checkCurrent(current)
    if (proxy == null || proxy.type() == Proxy.Type.DIRECT) return null
    if (!config.allowFallback) {
      report(current, DnsRouteResult.PROXY_CONFLICT)
      throw EncryptedDnsFailure(DnsRouteResult.PROXY_CONFLICT)
    }
    val address = proxy.address() as? InetSocketAddress ?: throw IOException("系统代理地址无效")
    val resolved = address.address ?: systemDns.lookup(address.hostString).first()
    report(current, DnsRouteResult.SYSTEM_PROXY)
    return Proxy(proxy.type(), InetSocketAddress(resolved, address.port))
  }

  private fun report(current: NetworkResolvers, result: DnsRouteResult, provider: String? = null) {
    checkCurrent(current)
    onResult(result, provider)
  }

  private fun checkCurrent(current: NetworkResolvers) {
    if (resolver !== current) throw IOException("设备网络已切换")
  }

  @Synchronized fun reset() {
    val previous = resolver ?: return
    resolver = NetworkResolvers()
    previous.close()
  }

  @Synchronized override fun close() {
    val previous = resolver ?: return
    resolver = null
    try {
      previous.close()
    } finally {
      dnsCalls.shutdown()
      onClose()
    }
  }
}
