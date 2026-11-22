package com.wz.reader

import android.os.Handler
import android.os.Looper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.content.Context
import android.webkit.WebSettings
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewStartUpConfig
import androidx.webkit.WebViewStartUpResult
import androidx.webkit.WebViewStartupException
import androidx.webkit.WebViewOutcomeReceiver
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.ForkJoinPool
import java.util.concurrent.FutureTask
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock

internal fun readDefaultWebViewUserAgentOnMainThread(
  isMainThread: Boolean,
  postToMainThread: (Runnable) -> Boolean,
  timeoutMs: Long = 10_000L,
  readUserAgent: () -> String
): String {
  if (isMainThread) return readUserAgent()
  // A background UA lookup can start Chromium asynchronously before the first
  // UI-thread WebView initializes it. Keep this shared startup read on main.
  val task = FutureTask<String> { readUserAgent() }
  check(postToMainThread(task)) { "无法调度 WebView User-Agent 读取" }
  return try {
    task.get(timeoutMs, TimeUnit.MILLISECONDS)
  } catch (error: InterruptedException) {
    Thread.currentThread().interrupt()
    throw error
  } catch (error: ExecutionException) {
    throw (error.cause ?: error)
  } finally {
    task.cancel(false)
  }
}

internal class DefaultWebViewUserAgentReader {
  private sealed interface CacheState {
    data object Unread : CacheState
    data class Ready(val value: String) : CacheState
  }
  @Volatile private var state: CacheState = CacheState.Unread

  fun read(
    isMainThread: Boolean,
    postToMainThread: (Runnable) -> Boolean,
    readUserAgent: () -> String
  ): String {
    when (val current = state) {
      is CacheState.Ready -> return current.value
      CacheState.Unread -> Unit
    }
    return readDefaultWebViewUserAgentOnMainThread(isMainThread, postToMainThread, readUserAgent = {
      when (val current = state) {
        is CacheState.Ready -> current.value
        CacheState.Unread -> {
          val userAgent = try {
            readUserAgent()
          } catch (error: AssertionError) {
            throw IllegalStateException("默认浏览器身份读取失败", error)
          }
          userAgent.trim().replace(Regex("\\s+"), " ").also {
            check(it.isNotEmpty()) { "默认浏览器身份读取失败" }
            state = CacheState.Ready(it)
          }
        }
      }
    })
  }
}

private val processDefaultUserAgentReader = DefaultWebViewUserAgentReader()

internal fun readProcessDefaultWebViewUserAgent(context: Context): String =
  processDefaultUserAgentReader.read(
    isMainThread = Looper.myLooper() == Looper.getMainLooper(),
    postToMainThread = { action -> Handler(Looper.getMainLooper()).post(action) },
    readUserAgent = { WebSettings.getDefaultUserAgent(context) }
  )

private enum class WebViewProxyCompletion { WAITING, COMPLETED, EXPIRED }

internal fun awaitWebViewProxyOperation(
  timeoutMessage: String,
  timeoutMs: Long = 10_000,
  onTimeoutOrLateCompletion: () -> Unit = {},
  onLateCompletion: () -> Unit = onTimeoutOrLateCompletion,
  start: ((() -> Unit) -> Unit)
) {
  val latch = CountDownLatch(1)
  val completion = AtomicReference(WebViewProxyCompletion.WAITING)
  start {
    if (!completion.compareAndSet(WebViewProxyCompletion.WAITING, WebViewProxyCompletion.COMPLETED) &&
      completion.get() == WebViewProxyCompletion.EXPIRED) {
      onLateCompletion()
    }
    latch.countDown()
  }
  val completed = try {
    latch.await(timeoutMs, TimeUnit.MILLISECONDS)
  } catch (error: InterruptedException) {
    completion.set(WebViewProxyCompletion.EXPIRED)
    onTimeoutOrLateCompletion()
    Thread.currentThread().interrupt()
    throw error
  }
  if (!completed) {
    completion.set(WebViewProxyCompletion.EXPIRED)
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

internal class OwnedProxyServerRegistry {
  private sealed interface WebViewConfirmation {
    data object Unconfirmed : WebViewConfirmation
    data class Confirmed(val profile: NetworkProxyProfile?) : WebViewConfirmation
  }
  private sealed interface Ownership {
    data object Unowned : Ownership
    data class Owned(
      val owner: Long,
      val server: LocalNetworkProxyServer?,
      val webView: WebViewConfirmation = WebViewConfirmation.Unconfirmed
    ) : Ownership
  }
  private val lock = Any()
  private var latestOwner = 0L
  private var ownership: Ownership = Ownership.Unowned
  private var stateGeneration = 0L

  // The caller holds the shared WebView operation lock through apply and confirmation.
  fun apply(owner: Long, profile: NetworkProxyProfile?, operation: () -> Int?): Int? {
    synchronized(lock) {
      check(owner == latestOwner) { "代理 bridge 已失效" }
      val current = ownership
      if (current is Ownership.Owned && current.webView is WebViewConfirmation.Confirmed &&
        current.webView.profile == profile) {
        ownership = current.copy(owner = owner)
        return current.server?.port
      }
    }
    return operation()
  }

  fun confirmWebView(owner: Long, profile: NetworkProxyProfile?, expectedGeneration: Long): Boolean = synchronized(lock) {
    val current = ownership
    if (current !is Ownership.Owned || current.owner != owner || latestOwner != owner ||
      stateGeneration != expectedGeneration || (profile == null) != (current.server == null)) {
      return@synchronized false
    }
    ownership = current.copy(webView = WebViewConfirmation.Confirmed(profile))
    true
  }

  fun markWebViewUnconfirmed() {
    synchronized(lock) {
      val current = ownership
      if (current is Ownership.Owned) {
        ownership = current.copy(webView = WebViewConfirmation.Unconfirmed)
      }
      stateGeneration += 1
    }
  }

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
    val previous = (ownership as? Ownership.Owned)?.server
    ownership = Ownership.Owned(owner, null)
    onBegin()
    stateGeneration += 1
    previous
  }

  fun commit(owner: Long, next: LocalNetworkProxyServer?, onCommit: () -> Unit): Boolean = synchronized(lock) {
    val current = ownership
    if (current !is Ownership.Owned || current.owner != owner || latestOwner != owner) {
      return@synchronized false
    }
    ownership = Ownership.Owned(owner, next)
    onCommit()
    stateGeneration += 1
    true
  }

  fun release(owner: Long, onRelease: () -> Unit): LocalNetworkProxyServer? = synchronized(lock) {
    val current = ownership
    if (current !is Ownership.Owned || current.owner != owner) {
      return@synchronized null
    }
    val previous = current.server
    ownership = Ownership.Unowned
    onRelease()
    stateGeneration += 1
    previous
  }

  fun requireCurrent(owner: Long) {
    synchronized(lock) {
      val current = ownership
      check(current is Ownership.Owned && current.owner == owner && latestOwner == owner) { "代理 bridge 已失效" }
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
  @Volatile private var invalidated = false

  private val loginDeletionListener: () -> Unit = {
    if (!invalidated && reactContext.hasActiveReactInstance())
      reactContext.emitDeviceEvent("linuxDoLoginCookieDeleted", null)
  }
  private val connectivity = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  init {
    proxyServers.register(owner)
    LinuxDoCookieResponses.loginDeletionListener.set(loginDeletionListener)
  }

  override fun getName(): String = "NetworkProxyModule"

  @ReactMethod
  fun getDefaultWebViewUserAgent(promise: Promise) {
    try {
      worker.execute {
        try {
          check(!invalidated) { "默认浏览器身份 bridge 已失效" }
          val userAgent = readProcessDefaultWebViewUserAgent(reactContext)
          check(!invalidated) { "默认浏览器身份 bridge 已失效" }
          promise.resolve(userAgent)
        } catch (error: Exception) {
          promise.reject("E_DEFAULT_USER_AGENT", "默认浏览器身份读取失败", error)
        }
      }
    } catch (error: Exception) {
      promise.reject("E_DEFAULT_USER_AGENT", "默认浏览器身份读取失败", error)
    }
  }

  @ReactMethod
  fun applyProxy(profile: ReadableMap?, promise: Promise) {
    worker.execute {
      var transitionStarted = false
      var nextServer: LocalNetworkProxyServer? = null
      try {
        val appliedPort = webViewProxyOperations.run {
          check(!invalidated) { "代理 bridge 已销毁" }
          val parsed = profile?.let { parseProfile(it) }
          NetworkProxyRuntime.install(reactContext)
          proxyServers.apply(owner, parsed) {
            // ProxyController can load the provider without starting Chromium. Newer
            // providers reject its blocking worker-thread calls until startup completes.
            val webViewReady = CompletableFuture<WebViewStartUpResult>()
            WebViewCompat.startUpWebView(
              reactContext,
              WebViewStartUpConfig.Builder(ForkJoinPool.commonPool()).build(),
              object : WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException> {
                override fun onResult(result: WebViewStartUpResult) { webViewReady.complete(result) }
                override fun onError(error: WebViewStartupException) { webViewReady.completeExceptionally(error) }
              }
            )
            webViewReady.get(10, TimeUnit.SECONDS)
            check(!invalidated) { "代理 bridge 已销毁" }
            if (parsed != null && !WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
              throw UnsupportedOperationException("当前 WebView 不支持应用代理")
            }
            beginTransition()
            transitionStarted = true
            val port = if (parsed == null) {
              clearWebViewProxy()
              if (!commitServer(null)) {
                throw IllegalStateException("代理 bridge 已被替换")
              }
              null
            } else {
              val server = LocalNetworkProxyServer(parsed)
              nextServer = server
              server.start()
              applyWebViewProxy(server.port)
              if (!commitServer(server)) {
                throw IllegalStateException("代理 bridge 已被替换")
              }
              nextServer = null // Publication transfers cleanup to the shared owner.
              server.port
            }
            val generation = proxyServers.generation()
            synchronizeWebViewProxyWithRuntime()
            check(!invalidated && proxyServers.confirmWebView(owner, parsed, generation)) { "无法确认 WebView 代理状态" }
            port
          }
        }
        promise.resolve(statusMap(true, appliedPort))
      } catch (error: Exception) {
        if (transitionStarted) {
          if (releaseOwnedServer()) restoreWebViewProxyFromRuntime()
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
  fun recoverForumReadChannel(source: String, expectedGeneration: Double, traceIdentity: String, promise: Promise) {
    worker.execute {
      try {
        val result = NetworkProxyRuntime.recoverForumReadChannel(
          source,
          requireReadNetworkGeneration(expectedGeneration),
          traceIdentity
        )
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", true)
          putBoolean("rotated", result.rotated)
          putDouble("previousGeneration", result.previousGeneration.toDouble())
          putDouble("generation", result.generation.toDouble())
          putInt("canceledQueued", result.canceledQueued)
          putInt("canceledRunning", result.canceledRunning)
        })
      } catch (error: Exception) {
        promise.reject("forum_read_channel_recovery_failed", error.message ?: "论坛读取通道自愈失败", error)
      }
    }
  }

  @ReactMethod
  fun retainReadNetworkGeneration(generation: Double, promise: Promise) {
    try {
      val lease = NetworkProxyRuntime.retainReadNetworkGeneration(requireReadNetworkGeneration(generation))
      promise.resolve(Arguments.createMap().apply {
        putBoolean("retained", lease.retained)
        putDouble("generation", lease.generation.toDouble())
      })
    } catch (error: Exception) {
      promise.reject("read_network_generation_retain_failed", "无法保留读取网络运行时", error)
    }
  }

  @ReactMethod
  fun acknowledgeReadNetworkRuntimeApply(
    traceIdentity: String,
    previousGeneration: Double,
    generation: Double,
    promise: Promise
  ) {
    try {
      promise.resolve(
        NetworkProxyRuntime.acknowledgeReadNetworkRuntimeApply(
          traceIdentity,
          requireReadNetworkGeneration(previousGeneration),
          requireReadNetworkGeneration(generation)
        )
      )
    } catch (error: Exception) {
      promise.reject("read_network_runtime_apply_ack_failed", "无法确认读取网络运行时状态发布", error)
    }
  }

  @ReactMethod
  fun releaseReadNetworkGeneration(generation: Double, promise: Promise) {
    try {
      promise.resolve(NetworkProxyRuntime.releaseReadNetworkGeneration(requireReadNetworkGeneration(generation)))
    } catch (error: Exception) {
      promise.reject("read_network_generation_release_failed", "无法释放读取网络运行时", error)
    }
  }

  @ReactMethod
  fun getSystemNetworkType(promise: Promise) {
    try {
      val network = connectivity.activeNetwork
      val caps = network?.let(connectivity::getNetworkCapabilities)
      promise.resolve(when {
        network == null -> "offline"
        caps == null -> "unknown"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "unknown"
      })
    } catch (_: SecurityException) {
      promise.resolve("unknown")
    }
  }

  @ReactMethod
  fun readNetworkDiagnosticEvents(promise: Promise) {
    try {
      val events = Arguments.createArray()
      NetworkProxyRuntime.readNetworkDiagnosticEvents().forEach { event ->
        events.pushMap(Arguments.createMap().apply {
          putDouble("timeMs", event.timeMs.toDouble())
          event.fields.forEach { (key, value) ->
            when (value) {
              is Boolean -> putBoolean(key, value)
              is Number -> putDouble(key, value.toDouble())
              is String -> putString(key, value)
            }
          }
        })
      }
      promise.resolve(events)
    } catch (error: Exception) {
      promise.reject("network_diagnostics_read_failed", "无法读取原生网络诊断", error)
    }
  }

  @ReactMethod
  fun setLinuxDoCookieResponseBarrier(blocked: Boolean, reason: String, diagnostics: ReadableMap, promise: Promise) {
    worker.execute {
      try {
        LinuxDoCookieResponses.store.setBarrier(blocked, reason, diagnostics.toHashMap().filterValues { it != null }.mapValues { it.value!! })
        promise.resolve(null)
      } catch (_: Exception) {
        promise.reject("cookie_barrier_failed", "登录会话交接未完成，请重试")
      }
    }
  }

  @ReactMethod
  fun clearManagedLoginCookies(source: String, diagnostics: ReadableMap, promise: Promise) {
    worker.execute {
      try {
        promise.resolve(NetworkProxyRuntime.clearManagedLoginCookies(source, diagnostics.toHashMap().filterValues { it != null }.mapValues { it.value!! }))
      } catch (error: Exception) {
        promise.reject("cookie_clear_failed", "无法清除登录 Cookie", error)
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
    return NetworkProxyProfile(protocol, host, port, username?.ifBlank { null }, password)
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
    proxyServers.markWebViewUnconfirmed()
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

  private fun releaseOwnedServer(): Boolean {
    var released = false
    val previous = webViewProxyOperations.run {
      proxyServers.release(owner) {
        released = true
        NetworkProxyRuntime.blockNetworkRequests()
      }
    }
    previous?.stop()
    return released
  }

  override fun invalidate() {
    invalidated = true
    LinuxDoCookieResponses.loginDeletionListener.compareAndSet(loginDeletionListener, null)
    worker.shutdownNow()
    if (releaseOwnedServer()) restoreWebViewProxyFromRuntime()
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
