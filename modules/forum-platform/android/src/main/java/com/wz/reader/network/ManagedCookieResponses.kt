package com.wz.reader

import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import androidx.webkit.CookieManagerCompat
import androidx.webkit.WebViewFeature
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicIntegerArray
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Call
import okhttp3.Cookie
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

// Request-local observations only; CookieManager is the sole credential store.
internal fun cfClearanceValue(header: String?): String? = header?.split(';')
  ?.map { it.trim() }?.firstOrNull { it.startsWith("cf_clearance=") }
  ?.substringAfter('=')?.takeIf { it.isNotEmpty() }

private fun cfClearanceValues(header: String?): List<String> = header.orEmpty().split(';')
  .map { it.trim() }.filter { it.startsWith("cf_clearance=") }.map { it.substringAfter('=') }

internal class CookieResponseScope(val epoch: Long) {
  private sealed interface Access {
    val url: String?
    data class Unmanaged(override val url: String?) : Access
    data class Managed(override val url: String) : Access
    data class Downgraded(override val url: String) : Access
  }
  private var access: Access = Access.Unmanaged(null)
  val downgraded: Boolean get() = access is Access.Downgraded
  val url: String? get() = access.url
  val managedRead: Boolean get() = access is Access.Managed

  fun observe(url: String, source: String?) {
    access = if (source != "linuxdo" || access is Access.Downgraded) Access.Downgraded(url) else Access.Managed(url)
  }

  fun revokeManagedRead() {
    val current = access
    if (current is Access.Managed) access = Access.Unmanaged(current.url)
  }
}

internal class CookieResponseBatch(val size: Int) {
  val done = CountDownLatch(size)
  val abandoned = AtomicBoolean(false)
  private val next = AtomicInteger()
  private val results = AtomicIntegerArray(size) // 0 pending, 1 accepted, 2 rejected, 3 not submitted
  val successful: Boolean get() = (0 until size).all { results.get(it) <= 1 }
  private val settled = AtomicReference<(() -> Unit)?>(null)
  fun complete(accepted: Boolean, index: Int = next.getAndIncrement()) {
    finish(index, if (accepted) 1 else 2)
  }
  fun skip(index: Int) = finish(index, 3)
  private fun finish(index: Int, result: Int) {
    if (!results.compareAndSet(index, 0, result)) return
    done.countDown()
    if (done.count == 0L) settled.getAndSet(null)?.invoke()
  }
  fun whenSettled(callback: () -> Unit) {
    settled.set(callback)
    if (done.count == 0L) settled.getAndSet(null)?.invoke()
  }
  fun result(index: Int) = when (results.get(index)) { 1 -> "accepted"; 2 -> "rejected"; 3 -> "not_submitted"; else -> "pending" }
  fun await(timeoutMs: Long): Boolean = done.await(timeoutMs, TimeUnit.MILLISECONDS)
}

private fun loginCookieValues(header: String?): List<String> = header.orEmpty().split(';')
  .map { it.trim().split('=', limit = 2) }
  .filter { it.size == 2 && it[0] == "_t" }.map { it[1] }

internal fun loginCookieValue(header: String?): String? = loginCookieValues(header).firstOrNull { it.isNotEmpty() }

internal fun cookieEndpoint(request: Request): String = when {
  request.url.encodedPath == "/session/current.json" -> "auth"
  request.url.host == "connect.linux.do" -> "connect"
  request.url.encodedPath == "/site.json" -> "site-config"
  request.url.encodedPath.startsWith("/categories") -> "categories"
  request.url.encodedPath.startsWith("/notifications") -> "notifications"
  request.url.encodedPath.startsWith("/t/") -> "topic"
  request.url.encodedPath.startsWith("/latest") || request.url.encodedPath.startsWith("/top") -> "feed"
  else -> "other"
}

internal fun cookieResponseItem(request: Request, value: String, index: Int): Map<String, Any> {
  val cookie = Cookie.parse(request.url, value)
  val name = value.substringBefore('=').trim()
  val expired = cookie != null && cookie.expiresAt <= System.currentTimeMillis()
  return mapOf(
    "cookieIndex" to index,
    "cookieKind" to when (name) {
      "_t" -> "login"; "_forum_session" -> "session"; "cf_clearance" -> "clearance"
      "_cfuvid", "__cf_bm" -> "bot-management"
      "auth.session-token" -> "connect"; else -> "other"
    },
    "cookieAction" to if (cookie == null) "unknown" else if (expired) "delete" else "set",
    "cookieLifetime" to if (cookie == null) "unknown" else if (expired) "expired" else if (cookie.persistent) "persistent" else "session"
  )
}

private data class PendingCookieWrite(
  val batch: CookieResponseBatch,
  val fields: Map<String, Any>,
  val items: List<Map<String, Any>>,
  val started: Long,
  val checkLoginDeletionUrl: String?
)

internal class ManagedCookieResponses(
  private val reader: (String) -> String?,
  private val writer: (String, List<String>) -> CookieResponseBatch,
  private val report: (Map<String, Any>) -> Unit = {},
  private val timeoutMs: Long = 5000L,
  private val flusher: () -> Unit = {},
  private val background: (() -> Unit) -> Unit = {},
  private val cookieInfoReader: () -> List<String>? = { null },
  private val onLoginCookieDeleted: () -> Unit = {}
) {
  // ponytail: serialize platform writes only; network requests remain concurrent.
  private val lock = Any()
  @Volatile private var epoch = 0L
  private var writeSequence = 0L
  private sealed interface Handoff {
    data object Open : Handoff
    class OpenWithBaseline(val values: List<String>) : Handoff
    data object Blocked : Handoff
    class BlockedWithBaseline(val values: List<String>) : Handoff
  }
  private sealed interface Persistence {
    data object Clean : Persistence
    class Dirty(val fields: Map<String, Any>) : Persistence
    class Awaiting(val write: PendingCookieWrite) : Persistence
    class AwaitingDirty(val write: PendingCookieWrite, val fields: Map<String, Any>) : Persistence
  }
  private var handoff: Handoff = Handoff.Open
  private var persistence: Persistence = Persistence.Clean
  private val local = ThreadLocal<CookieResponseScope?>()

  private val blocked: Boolean
    get() = handoff is Handoff.Blocked || handoff is Handoff.BlockedWithBaseline
  private val surfaceClearance: List<String>?
    get() = when (val current = handoff) {
      is Handoff.OpenWithBaseline -> current.values
      is Handoff.BlockedWithBaseline -> current.values
      Handoff.Open, Handoff.Blocked -> null
    }
  private val pending: PendingCookieWrite?
    get() = when (val current = persistence) {
      is Persistence.Awaiting -> current.write
      is Persistence.AwaitingDirty -> current.write
      Persistence.Clean, is Persistence.Dirty -> null
    }
  private val dirty: Map<String, Any>?
    get() = when (val current = persistence) {
      is Persistence.Dirty -> current.fields
      is Persistence.AwaitingDirty -> current.fields
      Persistence.Clean, is Persistence.Awaiting -> null
    }

  private fun updateHandoff(nextBlocked: Boolean, baseline: List<String>?) {
    handoff = when {
      nextBlocked && baseline != null -> Handoff.BlockedWithBaseline(baseline)
      nextBlocked -> Handoff.Blocked
      baseline != null -> Handoff.OpenWithBaseline(baseline)
      else -> Handoff.Open
    }
  }

  private fun updatePersistence(nextPending: PendingCookieWrite?, nextDirty: Map<String, Any>?) {
    persistence = when {
      nextPending != null && nextDirty != null -> Persistence.AwaitingDirty(nextPending, nextDirty)
      nextPending != null -> Persistence.Awaiting(nextPending)
      nextDirty != null -> Persistence.Dirty(nextDirty)
      else -> Persistence.Clean
    }
  }

  private fun emit(fields: Map<String, Any>) {
    try { report(mapOf("source" to "linuxdo", "phase" to "finish", "outcome" to "success") + fields) }
    catch (_: Exception) { /* Diagnostics must not affect authentication. */ }
  }

  fun <T> within(block: () -> T): T {
    val previous = local.get()
    local.set(CookieResponseScope(epoch))
    try { return block() } finally {
      if (previous == null) local.remove() else local.set(previous)
    }
  }

  fun observed(url: String, source: String?, @Suppress("UNUSED_PARAMETER") header: String?) {
    val scope = local.get() ?: return
    scope.observe(url, source)
  }

  fun sending(request: Request, call: Call?, transport: String = "okhttp") {
    val scope = local.get() ?: return
    if (request.url.host != "linux.do" && !request.url.host.endsWith(".linux.do")) return
    val clearance = cfClearanceValues(request.header("Cookie"))
    val login = loginCookieValues(request.header("Cookie"))
    val stored = runCatching { reader(request.url.toString()) }
    emit(requestFields(request, call) + mapOf("operation" to "cookie-request", "cookieTransport" to transport,
      "requestCookieEpoch" to scope.epoch, "cookieEpoch" to epoch,
      "hasCfClearance" to clearance.any { it.isNotEmpty() },
      "cfClearanceCount" to clearance.size,
      "cfClearanceDistinctCount" to clearance.distinct().size,
      "loginCookieCount" to login.size,
      "hasLoginCookie" to (loginCookieValue(request.header("Cookie")) != null)) +
      (if (stored.isSuccess) cfClearanceValues(stored.getOrNull()).let { storedClearance -> mapOf(
        "hasStoredCfClearance" to storedClearance.any { it.isNotEmpty() },
        "isCfClearanceCurrent" to (clearance == storedClearance),
        "storedCfClearanceCount" to storedClearance.size,
        "storedCfClearanceDistinctCount" to storedClearance.distinct().size,
        "storedLoginCookieCount" to loginCookieValues(stored.getOrNull()).size,
        "isLoginCookieCurrent" to (login == loginCookieValues(stored.getOrNull()))) } else emptyMap()) +
      (request.header("User-Agent")?.let { mapOf("userAgentHash" to "%08x".format(it.hashCode())) } ?: emptyMap()))
  }

  private fun requestFields(request: Request, call: Call?): Map<String, Any> = buildMap {
    request.tag(RequestDiagnosticTag::class.java)?.fields()?.let(::putAll)
    request.tag(ImageDiagnosticTag::class.java)?.fields()?.let(::putAll)
    call?.let { put("callId", Integer.toHexString(System.identityHashCode(it))) }
    put("cookieEndpoint", cookieEndpoint(request)); put("method", request.method)
  }

  fun fallbackRequest(request: Request): Request = synchronized(lock) {
    val scope = local.get() ?: return request
    if (!scope.managedRead) return request
    val next = request.newBuilder().removeHeader("Cookie")
    if (blocked || scope.epoch != epoch || scope.url != request.url.toString()) {
      scope.revokeManagedRead()
    } else {
      val header = reader(request.url.toString())
      if (!header.isNullOrEmpty()) next.header("Cookie", header)
    }
    next.build()
  }

  private fun settlePending(waitMs: Long): Boolean {
    val write = pending ?: return true
    if (!write.batch.await(waitMs)) return false
    persistence = Persistence.Dirty(write.fields)
    write.items.forEachIndexed { index, item ->
      emit(write.fields + item + mapOf("operation" to "cookie-response", "cookieResult" to "settled",
        "cookieAccepted" to write.batch.result(index),
        "outcome" to if (write.batch.result(index) == "accepted") "success" else "failure",
        "elapsedMs" to TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - write.started)))
    }
    write.checkLoginDeletionUrl?.let { url ->
      if (runCatching { loginCookieValue(reader(url)) == null }.getOrDefault(false))
        background(onLoginCookieDeleted)
    }
    return true
  }

  private fun flushDirty(): Boolean {
    val fields = dirty ?: return true
    val start = System.nanoTime()
    try {
      flusher()
      updatePersistence(pending, null)
      emit(fields + mapOf("operation" to "cookie-persist", "cookieResult" to "persisted",
        "elapsedMs" to TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)))
      return true
    } catch (_: Exception) {
      emit(fields + mapOf("operation" to "cookie-persist", "cookieResult" to "flush_failed", "outcome" to "failure",
        "elapsedMs" to TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)))
      return false
    }
  }

  fun setBarrier(value: Boolean, reason: String = "identity-change", diagnostics: Map<String, Any> = emptyMap()) = synchronized(lock) {
    require(reason in setOf("startup", "source-change", "surface-open", "surface-close", "identity-change", "explicit-clear"))
    if (reason != "startup" || blocked != value) epoch++
    updateHandoff(true, surfaceClearance)
    val clearance = if (reason == "startup") null else runCatching { cfClearanceValues(reader("https://linux.do/")) }
    if (reason == "surface-open") {
      updateHandoff(blocked, clearance?.getOrNull())
    }
    val fields = diagnostics.filterKeys { it in setOf("appSessionId", "traceId", "surfaceGeneration") } +
      mapOf("operation" to "cookie-barrier", "cookieEpoch" to epoch, "cookieBarrierReason" to reason) +
      (if (reason == "startup") emptyMap() else try { mapOf("hasLoginCookie" to (loginCookieValue(reader("https://linux.do/")) != null)) }
        catch (_: Exception) { emptyMap() }) +
      (if (reason == "surface-open" || reason == "surface-close") mapOf("cookieTransport" to "webview") else emptyMap()) +
      (if (clearance?.isSuccess == true) mapOf("hasCfClearance" to clearance.getOrThrow().any { it.isNotEmpty() }) else emptyMap()) +
      (if (reason == "surface-open" || reason == "surface-close") cookieInfoFields() else emptyMap()) +
      (if (reason == "surface-close" && surfaceClearance != null && clearance?.isSuccess == true)
        mapOf("didCfClearanceChange" to (surfaceClearance != clearance.getOrNull())) else emptyMap())
    if (reason == "surface-close" || reason == "identity-change" || reason == "explicit-clear") {
      updateHandoff(blocked, null)
    }
    emit(fields + mapOf("phase" to "intent", "cookieBarrierBlocked" to true))
    if (!settlePending(timeoutMs)) {
      emit(fields + mapOf("cookieResult" to "callback_timeout", "outcome" to "failure"))
      throw IOException("Cookie response barrier unavailable")
    }
    // WebView owns its internal responses; its handoff still needs an explicit durable flush.
    if (reason == "surface-close") updatePersistence(pending, fields)
    if (!flushDirty()) throw IOException("Cookie persistence unavailable")
    updateHandoff(value, surfaceClearance)
    emit(fields + mapOf("cookieBarrierBlocked" to value))
  }

  private fun cookieInfoFields(): Map<String, Any> = try {
    val info = cookieInfoReader()
    if (info == null) mapOf("cfClearanceInfoResult" to "unsupported")
    else {
      val clearance = info.filter { it.substringBefore(';').trim().startsWith("cf_clearance=") }
      val partitioned = clearance.count { value ->
        value.split(';').drop(1).any { it.trim().equals("Partitioned", ignoreCase = true) }
      }
      mapOf("cfClearanceInfoResult" to "success", "cfClearancePartitionedCount" to partitioned,
        "cfClearanceUnpartitionedCount" to clearance.size - partitioned)
    }
  } catch (_: Exception) { mapOf("cfClearanceInfoResult" to "failed") }

  fun receive(response: Response, call: Call? = null) {
    val scope = local.get() ?: return
    val values = response.headers.values("Set-Cookie")
    val url = response.request.url.toString()
    val host = response.request.url.host
    if (!scope.managedRead && host != "linux.do" && !host.endsWith(".linux.do")) return
    synchronized(lock) {
      val fields = requestFields(response.request, call) + mapOf("cookieCount" to values.size,
        "status" to response.code, "requestCookieEpoch" to scope.epoch, "cookieEpoch" to epoch)
      val items = values.mapIndexed { index, value -> cookieResponseItem(response.request, value, index) }
      fun record(reason: String, outcome: String = "noop", observed: List<Map<String, Any>> = items) {
        (observed.ifEmpty { listOf(emptyMap()) }).forEach { item ->
          emit(fields + item + mapOf("operation" to "cookie-response", "cookieResult" to reason,
            "cookieWriteSequence" to writeSequence, "outcome" to outcome))
        }
      }
      if (scope.downgraded) { record("redirect_denied"); return }
      if (!scope.managedRead || scope.url != url) { record("source_denied"); return }
      if (blocked) { record("barrier_blocked"); return }
      if (scope.epoch != epoch) { record("epoch_changed"); return }
      if (!settlePending(timeoutMs)) { record("pending_write", "failure"); return }
      if (values.isEmpty()) { flushDirty(); record("absent"); return }
      // A diagnostic observation failure must never suppress a valid platform update.
      val before = runCatching { loginCookieValues(reader(url)).filter(String::isNotEmpty) }
      val sent = loginCookieValues(response.request.header("Cookie")).filter(String::isNotEmpty)
      val staleLogin = sent.isNotEmpty() && before.getOrNull()?.none(sent::contains) == true
      val acceptedIndices = if (staleLogin) {
        val loginIndices = items.indices.filter { items[it]["cookieKind"] == "login" }
        if (loginIndices.isNotEmpty()) record("login_superseded", observed = loginIndices.map(items::get))
        items.indices.filterNot(loginIndices::contains)
      } else items.indices.toList()
      if (acceptedIndices.isEmpty()) { flushDirty(); return }
      val acceptedItems = acceptedIndices.map(items::get)
      try {
        val batch = writer(url, acceptedIndices.map(values::get))
        writeSequence++
        val writeFields = fields + mapOf("cookieWriteSequence" to writeSequence)
        val checkingDeletion = before.getOrNull()?.isNotEmpty() == true &&
          acceptedItems.any { it["cookieKind"] == "login" && it["cookieAction"] == "delete" }
        updatePersistence(PendingCookieWrite(batch, writeFields, acceptedItems, System.nanoTime(),
          url.takeIf { checkingDeletion }), dirty)
        if (!settlePending(timeoutMs)) {
          batch.abandoned.set(true)
          batch.whenSettled {
            // Never acquire this lock from a platform callback: the caller may be waiting for it.
            background {
              synchronized(lock) {
                if (pending?.batch === batch && settlePending(0)) flushDirty()
              }
            }
          }
          record("callback_timeout", "failure")
          return
        }
        val after = runCatching { loginCookieValues(reader(url)).filter(String::isNotEmpty) }
        emit(writeFields + mapOf("operation" to "cookie-response", "cookieResult" to "applied",
          "outcome" to if (batch.successful) "success" else "failure") +
          (if (after.isSuccess) mapOf("hasLoginCookie" to after.getOrThrow().isNotEmpty()) else emptyMap()) +
          (if (before.isSuccess && after.isSuccess) mapOf("loginCookieChanged" to (before.getOrNull() != after.getOrNull())) else emptyMap()))
        flushDirty()
      } catch (_: Exception) {
        record("write_failed", "failure")
      }
    }
  }
}

internal object LinuxDoCookieResponses {
  val loginDeletionListener = AtomicReference<(() -> Unit)?>(null)
  private val completionWorker = Executors.newSingleThreadExecutor { task -> Thread(task, "cookie-completion").apply { isDaemon = true } }
  val store = ManagedCookieResponses(
    reader = { CookieManager.getInstance().getCookie(it) },
    writer = ::writePlatformCookieResponses,
    report = { ReadNetworkDiagnostics.record(it) },
    flusher = { CookieManager.getInstance().flush() },
    background = { completionWorker.execute(it) },
    cookieInfoReader = {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.GET_COOKIE_INFO))
        CookieManagerCompat.getCookieInfo(CookieManager.getInstance(), "https://linux.do/")
      else null
    },
    onLoginCookieDeleted = { loginDeletionListener.get()?.invoke() }
  )
}

internal fun writePlatformCookieResponses(url: String, values: List<String>): CookieResponseBatch {
  val batch = CookieResponseBatch(values.size)
  val posted = Handler(Looper.getMainLooper()).post {
    values.forEachIndexed { index, value ->
      if (batch.abandoned.get()) batch.skip(index)
      else try {
        CookieManager.getInstance().setCookie(url, value) { accepted -> batch.complete(accepted, index) }
      } catch (_: Exception) { batch.complete(false, index) }
    }
  }
  if (!posted) repeat(values.size) { batch.complete(false, it) }
  return batch
}

internal class CookieResponseContextInterceptor(private val store: ManagedCookieResponses) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response = store.within { chain.proceed(chain.request()) }
}

internal class CookieResponseInterceptor(private val store: ManagedCookieResponses) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    store.sending(chain.request(), chain.call())
    val response = chain.proceed(chain.request())
    store.receive(response, chain.call())
    return response
  }
}
