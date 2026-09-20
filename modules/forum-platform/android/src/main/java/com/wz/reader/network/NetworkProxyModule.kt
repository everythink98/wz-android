package com.wz.reader

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
import java.util.concurrent.ForkJoinPool
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
