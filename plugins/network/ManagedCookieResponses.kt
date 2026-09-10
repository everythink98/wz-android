package com.wz.reader

import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
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
internal class CookieResponseScope(val epoch: Long) {
  var downgraded = false
  var url: String? = null
  var managedRead = false
}

internal class CookieResponseBatch(val size: Int) {
  val done = CountDownLatch(size)
  val successful = AtomicBoolean(true)
  val abandoned = AtomicBoolean(false)
  private val next = AtomicInteger()
  private val results = AtomicIntegerArray(size) // 0 pending, 1 accepted, 2 rejected, 3 not submitted
  private val settled = AtomicReference<(() -> Unit)?>(null)
  fun complete(accepted: Boolean, index: Int = next.getAndIncrement()) {
    finish(index, if (accepted) 1 else 2)
  }
  fun skip(index: Int) = finish(index, 3)
  private fun finish(index: Int, result: Int) {
    if (!results.compareAndSet(index, 0, result)) return
    if (result != 1) successful.set(false)
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

internal fun loginCookieValue(header: String?): String? = header.orEmpty().split(';')
  .map { it.trim().split('=', limit = 2) }
  .firstOrNull { it.size == 2 && it[0] == "_t" }?.get(1)?.takeIf { it.isNotEmpty() }

internal fun cookieEndpoint(request: Request): String = when {
  request.url.encodedPath == "/session/current.json" -> "auth"
  request.url.host == "connect.linux.do" -> "connect"
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
      "_t" -> "login"; "_forum_session" -> "session"; "cf_clearance", "_cfuvid", "__cf_bm" -> "clearance"
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
  val started: Long
)

internal class ManagedCookieResponses(
  private val reader: (String) -> String?,
  private val writer: (String, List<String>) -> CookieResponseBatch,
  private val report: (Map<String, Any>) -> Unit = {},
  private val timeoutMs: Long = 5000L,
  private val flusher: () -> Unit = {},
  private val background: (() -> Unit) -> Unit = {}
) {
  // ponytail: serialize platform writes only; network requests remain concurrent.
  private val lock = Any()
  @Volatile private var epoch = 0L
  private var writeSequence = 0L
  private var blocked = false
  private var pending: PendingCookieWrite? = null
  private var dirty: Map<String, Any>? = null
  private val local = ThreadLocal<CookieResponseScope?>()

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
    if (source != "linuxdo") scope.downgraded = true
    scope.url = url
    scope.managedRead = source == "linuxdo" && !scope.downgraded
  }

  fun sending(request: Request, call: Call?, transport: String = "okhttp") {
    val scope = local.get() ?: return
    if (request.url.host != "linux.do" && !request.url.host.endsWith(".linux.do")) return
    emit(requestFields(request, call) + mapOf("operation" to "cookie-request", "cookieTransport" to transport,
      "requestCookieEpoch" to scope.epoch, "cookieEpoch" to epoch,
      "hasLoginCookie" to (loginCookieValue(request.header("Cookie")) != null)))
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
      scope.managedRead = false
    } else {
      val header = reader(request.url.toString())
      if (!header.isNullOrEmpty()) next.header("Cookie", header)
    }
    next.build()
  }

  private fun settlePending(waitMs: Long): Boolean {
    val write = pending ?: return true
    if (!write.batch.await(waitMs)) return false
    pending = null
    dirty = write.fields
    write.items.forEachIndexed { index, item ->
      emit(write.fields + item + mapOf("operation" to "cookie-response", "cookieResult" to "settled",
        "cookieAccepted" to write.batch.result(index),
        "outcome" to if (write.batch.result(index) == "accepted") "success" else "failure",
        "elapsedMs" to TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - write.started)))
    }
    return true
  }

  private fun flushDirty() {
    val fields = dirty ?: return
    val start = System.nanoTime()
    try {
      flusher()
      dirty = null
      emit(fields + mapOf("operation" to "cookie-persist", "cookieResult" to "persisted",
        "elapsedMs" to TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)))
    } catch (_: Exception) {
      emit(fields + mapOf("operation" to "cookie-persist", "cookieResult" to "flush_failed", "outcome" to "failure",
        "elapsedMs" to TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)))
    }
  }

  fun setBarrier(value: Boolean, reason: String = "identity-change", diagnostics: Map<String, Any> = emptyMap()) = synchronized(lock) {
    require(reason in setOf("startup", "source-change", "surface-open", "surface-close", "identity-change", "explicit-clear"))
    if (reason != "startup" || blocked != value) epoch++
    blocked = value
    val fields = diagnostics.filterKeys { it in setOf("appSessionId", "traceId", "surfaceGeneration") } +
      mapOf("operation" to "cookie-barrier", "cookieEpoch" to epoch, "cookieBarrierReason" to reason) +
      (try { mapOf("hasLoginCookie" to (loginCookieValue(reader("https://linux.do/")) != null)) }
        catch (_: Exception) { emptyMap() }) +
      (if (reason == "surface-open" || reason == "surface-close") mapOf("cookieTransport" to "webview") else emptyMap())
    emit(fields + mapOf("phase" to "intent", "cookieBarrierBlocked" to true))
    if (!settlePending(timeoutMs)) {
      emit(fields + mapOf("cookieResult" to "callback_timeout", "outcome" to "failure"))
      throw IOException("Cookie response barrier unavailable")
    }
    // WebView owns its internal responses; its handoff still needs an explicit durable flush.
    if (reason == "surface-close") dirty = fields
    flushDirty()
    emit(fields + mapOf("cookieBarrierBlocked" to value))
  }

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
      fun record(reason: String, outcome: String = "noop") {
        (items.ifEmpty { listOf(emptyMap()) }).forEach { item ->
          emit(fields + item + mapOf("operation" to "cookie-response", "cookieResult" to reason,
            "cookieWriteSequence" to writeSequence, "outcome" to outcome))
        }
      }
      if (scope.downgraded) { record("redirect_denied"); return }
      if (!scope.managedRead || scope.url != url) { record("source_denied"); return }
      if (blocked) { record("barrier_blocked"); return }
      if (scope.epoch != epoch) { record("epoch_changed"); return }
      if (call?.isCanceled() == true) { record("canceled"); return }
      if (!settlePending(timeoutMs)) { record("pending_write", "failure"); return }
      if (call?.isCanceled() == true) { record("canceled"); return }
      if (values.isEmpty()) { flushDirty(); record("absent"); return }
      // A diagnostic observation failure must never suppress a valid platform update.
      val before = runCatching { loginCookieValue(reader(url)) }
      try {
        val batch = writer(url, values)
        writeSequence++
        val writeFields = fields + mapOf("cookieWriteSequence" to writeSequence)
        pending = PendingCookieWrite(batch, writeFields, items, System.nanoTime())
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
        val after = runCatching { loginCookieValue(reader(url)) }
        emit(writeFields + mapOf("operation" to "cookie-response", "cookieResult" to "applied",
          "outcome" to if (batch.successful.get()) "success" else "failure") +
          (if (after.isSuccess) mapOf("hasLoginCookie" to (after.getOrNull() != null)) else emptyMap()) +
          (if (before.isSuccess && after.isSuccess) mapOf("loginCookieChanged" to (before.getOrNull() != after.getOrNull())) else emptyMap()))
        flushDirty()
      } catch (_: Exception) {
        record("write_failed", "failure")
      }
    }
  }
}

internal object LinuxDoCookieResponses {
  private val completionWorker = Executors.newSingleThreadExecutor { task -> Thread(task, "cookie-completion").apply { isDaemon = true } }
  val store = ManagedCookieResponses(
    reader = { CookieManager.getInstance().getCookie(it) },
    writer = ::writePlatformCookieResponses,
    report = { ReadNetworkDiagnostics.record(it) },
    flusher = { CookieManager.getInstance().flush() },
    background = { completionWorker.execute(it) }
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
