const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function networkProxyRuntimeSource(packageName) {
  return `package ${packageName}

import android.content.Context
import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.EOFException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.IDN
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import android.util.Base64

data class NetworkProxyProfile(
  val protocol: String,
  val host: String,
  val port: Int,
  val username: String?,
  val password: String?
)

private data class ProxyTarget(val host: String, val port: Int)
private const val BLOCKED_PROXY_PORT = 9

object NetworkProxyRuntime {
  private val lock = Any()
  private val selector = NetworkProxySelector()
  private val blockedProxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", BLOCKED_PROXY_PORT))
  @Volatile private var localProxy: Proxy? = null
  private var installed = false

  fun install(context: Context) {
    synchronized(lock) {
      if (installed) {
        return
      }
      val appContext = context.applicationContext
      selector.setDelegate(ProxySelector.getDefault())
      ProxySelector.setDefault(selector)
      OkHttpClientProvider.setOkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder(appContext).proxySelector(selector).build()
      }
      NetworkingModule.setCustomClientBuilder { builder ->
        builder.proxySelector(selector)
      }
      installed = true
    }
  }

  fun setLocalProxyPort(port: Int?) {
    localProxy = if (port == null) {
      null
    } else {
      Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", port))
    }
  }

  fun blockNetworkRequests() {
    localProxy = blockedProxy
  }

  fun currentLocalProxy(): Proxy? = localProxy
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

class LocalNetworkProxyServer(private val upstream: NetworkProxyProfile) {
  private val serverSocket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
  private val executor = Executors.newCachedThreadPool()
  @Volatile private var running = true

  val port: Int
    get() = serverSocket.localPort

  fun start() {
    executor.execute {
      while (running) {
        try {
          val client = serverSocket.accept()
          executor.execute {
            handleClient(client)
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
    running = false
    try {
      serverSocket.close()
    } catch (_: IOException) {
    }
    executor.shutdownNow()
  }

  private fun handleClient(client: Socket) {
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
          local.getOutputStream().write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n".toByteArray(HEADER_CHARSET))
          local.soTimeout = 0
          pipeBoth(local, remote)
          return
        }

        val target = targetFromHttpRequest(parts[1], header)
        val remote = if (upstream.protocol == "http") {
          connectPlain(upstream.host, upstream.port)
        } else {
          connectViaSocks5(target)
        }
        val outboundHeader = if (upstream.protocol == "http") {
          headerWithHttpProxyAuthorization(header)
        } else {
          originHeaderForDirectRequest(header, parts, target)
        }
        remote.getOutputStream().write(outboundHeader.toByteArray(HEADER_CHARSET))
        local.soTimeout = 0
        pipeBoth(local, remote)
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
  }

  private fun connectToTarget(target: ProxyTarget): Socket =
    if (upstream.protocol == "http") connectViaHttpProxy(target) else connectViaSocks5(target)

  private fun connectViaHttpProxy(target: ProxyTarget): Socket {
    val socket = connectPlain(upstream.host, upstream.port)
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
      socket.close()
      throw IOException("HTTP proxy rejected CONNECT")
    }
    socket.soTimeout = 0
    return socket
  }

  private fun connectViaSocks5(target: ProxyTarget): Socket {
    val socket = connectPlain(upstream.host, upstream.port)
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
    val socket = connectToTarget(ProxyTarget("www.gstatic.com", 443))
    socket.close()
  }
}

private val HEADER_CHARSET: Charset = Charsets.ISO_8859_1
private val IPV4_PATTERN = Regex("^\\\\d{1,3}(\\\\.\\\\d{1,3}){3}$")

private fun connectPlain(host: String, port: Int): Socket {
  val socket = Socket()
  socket.connect(InetSocketAddress(host, port), 15_000)
  return socket
}

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

private fun pipeBoth(left: Socket, right: Socket) {
  right.use { remote ->
    val latch = CountDownLatch(2)
    val executor = Executors.newFixedThreadPool(2)
    executor.execute {
      try {
        copySocket(left.getInputStream(), remote.getOutputStream(), remote)
      } catch (_: Exception) {
      } finally {
        latch.countDown()
      }
    }
    executor.execute {
      try {
        copySocket(remote.getInputStream(), left.getOutputStream(), left)
      } catch (_: Exception) {
      } finally {
        latch.countDown()
      }
    }
    try {
      latch.await()
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    } finally {
      executor.shutdownNow()
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

class NetworkProxyModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val worker = Executors.newSingleThreadExecutor()

  override fun getName(): String = "NetworkProxyModule"

  @ReactMethod
  fun applyProxy(profile: ReadableMap?, promise: Promise) {
    worker.execute {
      try {
        NetworkProxyRuntime.install(reactContext)
        if (profile == null) {
          replaceServer(null)
          clearWebViewProxy()
          promise.resolve(statusMap(true, null))
          return@execute
        }
        val parsed = parseProfile(profile)
        val nextServer = LocalNetworkProxyServer(parsed)
        nextServer.start()
        blockServer()
        try {
          applyWebViewProxy(nextServer.port)
          replaceServer(nextServer)
          promise.resolve(statusMap(true, nextServer.port))
        } catch (error: Exception) {
          nextServer.stop()
          blockServer()
          try {
            clearWebViewProxy()
          } catch (_: Exception) {
          }
          promise.reject("proxy_apply_failed", error.message ?: "代理启动失败", error)
        }
      } catch (error: Exception) {
        if (profile != null) {
          blockServer()
          try {
            clearWebViewProxy()
          } catch (_: Exception) {
          }
        }
        promise.reject("proxy_apply_failed", error.message ?: "代理启动失败", error)
      }
    }
  }

  @ReactMethod
  fun testProxy(profile: ReadableMap, promise: Promise) {
    worker.execute {
      try {
        val probe = LocalNetworkProxyServer(parseProfile(profile))
        try {
          probe.test()
        } finally {
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
    val latch = CountDownLatch(1)
    val config = ProxyConfig.Builder()
      .addProxyRule("http://127.0.0.1:" + port)
      .addBypassRule("localhost")
      .addBypassRule("*.localhost")
      .addBypassRule("127.*")
      .addBypassRule("10.0.2.2")
      .addBypassRule("[::1]")
      .bypassSimpleHostnames()
      .build()
    ProxyController.getInstance().setProxyOverride(config, { runnable -> runnable.run() }) {
      latch.countDown()
    }
    if (!latch.await(10, TimeUnit.SECONDS)) {
      throw IllegalStateException("WebView 代理设置超时")
    }
  }

  private fun clearWebViewProxy() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      return
    }
    val latch = CountDownLatch(1)
    ProxyController.getInstance().clearProxyOverride({ runnable -> runnable.run() }) {
      latch.countDown()
    }
    latch.await(10, TimeUnit.SECONDS)
  }

  private fun statusMap(ok: Boolean, port: Int?) = Arguments.createMap().apply {
    putBoolean("ok", ok)
    if (port != null) {
      putDouble("port", port.toDouble())
    }
  }

  companion object {
    private val serverLock = Any()
    private var server: LocalNetworkProxyServer? = null

    private fun replaceServer(next: LocalNetworkProxyServer?) {
      val previous: LocalNetworkProxyServer?
      synchronized(serverLock) {
        previous = server
        server = next
        NetworkProxyRuntime.setLocalProxyPort(next?.port)
      }
      previous?.stop()
    }

    private fun blockServer() {
      val previous: LocalNetworkProxyServer?
      synchronized(serverLock) {
        previous = server
        server = null
        NetworkProxyRuntime.blockNetworkRequests()
      }
      previous?.stop()
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

module.exports = function withNetworkProxyModule(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = injectWebkitDependency(config.modResults.contents);
    return config;
  });

  config = withDangerousMod(config, ['android', async (config) => {
    const packageName = config.android?.package;
    if (!packageName) {
      return config;
    }
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
    return config;
  }]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectNetworkProxyInstall(injectNetworkProxyPackage(config.modResults.contents));
    return config;
  });
};
